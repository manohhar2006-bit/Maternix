# Maternix — AWS Deployment Readiness & Architecture Guide

## 1. Architecture Overview

Maternix is a maternal and infant healthcare management web application built with a Vanilla HTML5/CSS/JavaScript frontend, an Express.js (Node.js) REST API backend, and a cloud-hosted PostgreSQL database.

This guide provides technical specifications for deploying Maternix into an enterprise-grade, highly available, and secure environment on Amazon Web Services (AWS) using an **Application Load Balancer (ALB)** and **EC2 Auto Scaling Group (ASG)**.

```
                              Internet
                                 │
                          [Route 53 DNS]
                                 │
                          [ACM HTTPS / 443]
                                 │
                   [Application Load Balancer (ALB)]
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            [Public Subnet 1]         [Public Subnet 2]
             (NAT Gateway 1)           (NAT Gateway 2)
                    │                         │
      ══════════════╪═════════════════════════╪═════════════ VPC Boundary
                    │                         │
            [Private Subnet 1]        [Private Subnet 2]
        ┌─────────────────────────────────────────────────┐
        │        EC2 Auto Scaling Group (ASG)             │
        │   ┌─────────────────┐     ┌─────────────────┐   │
        │   │  EC2 Instance 1 │     │  EC2 Instance 2 │   │
        │   │  - Node.js 20   │     │  - Node.js 20   │   │
        │   │  - Express.js   │     │  - Express.js   │   │
        │   │  - CloudWatch   │     │  - CloudWatch   │   │
        │   └─────────────────┘     └─────────────────┘   │
        └─────────────────────────────────────────────────┘
                    │                         │
                    └────────────┬────────────┘
                                 │ (TLS / Service Role)
                                 ▼
                     [PostgreSQL Database Layer]
              (AWS RDS Multi-AZ / Supabase Managed DB)
```

---

## 2. Stateless Backend & Multi-Instance Auto Scaling

The Maternix backend has been refactored to be **100% stateless**:
1. **Stateless Session Management**: Authentication uses cryptographically signed JSON Web Tokens (JWT) stored in HttpOnly cookies or `Authorization: Bearer` headers. All EC2 instances sharing the same `JWT_SECRET` can verify and authorize requests without server-side session stores or sticky sessions.
2. **Elimination of Ephemeral State**: In-memory mock arrays are strictly disabled in production (`ENABLE_MOCK_FALLBACK=false`). All patient profiles, vital signs, prescriptions, appointments, and infant records are persisted exclusively in the managed database.
3. **Graceful Shutdown**: The Express server implements `SIGTERM` and `SIGINT` handlers, completing in-flight requests and closing sockets cleanly before an instance terminates during scale-in events.
4. **Target Group Health Probes**: The `/health` endpoint responds with HTTP 200 based on process liveness, completely decoupled from specific patient state.

---

## 3. Launch Template & EC2 User Data Configuration

### Recommended Instance Specifications
- **Operating System**: Amazon Linux 2023 (AMI)
- **Instance Type**: `t4g.small` (Graviton3, 2 vCPU, 2 GiB RAM) or `t3.small` (x86_64)
- **Storage**: 20 GiB gp3 encrypted EBS root volume (`aws/ebs` KMS key)
- **Network**: Private subnets only (no public IPv4 assigned to instances)

### EC2 User-Data Bootstrap Script
```bash
#!/bin/bash
set -e

# 1. Update OS packages and install Node.js 20 LTS
dnf update -y
dnf install -y nodejs git amazon-cloudwatch-agent

# 2. Install PM2 process manager globally
npm install -g pm2

# 3. Create application user and directory
useradd -m -s /bin/bash maternix
cd /home/maternix

# 4. Clone repository or pull build artifact from S3
# aws s3 cp s3://my-maternix-deployment-artifacts/maternix-latest.tar.gz .
# tar -xzf maternix-latest.tar.gz
git clone https://github.com/my-org/maternix-project.git app
cd app

# 5. Fetch production secrets from AWS Secrets Manager
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
SECRETS_JSON=$(aws secretsmanager get-secret-value --secret-id "maternix/production" --region "$REGION" --query SecretString --output text)

# Write environment configuration securely (0600 permissions)
cat <<EOF > .env
PORT=3000
NODE_ENV=production
JWT_SECRET=$(echo "$SECRETS_JSON" | jq -r .JWT_SECRET)
JWT_EXPIRES_IN=24h
SUPABASE_URL=$(echo "$SECRETS_JSON" | jq -r .SUPABASE_URL)
SUPABASE_SERVICE_ROLE_KEY=$(echo "$SECRETS_JSON" | jq -r .SUPABASE_SERVICE_ROLE_KEY)
FRONTEND_ORIGIN=$(echo "$SECRETS_JSON" | jq -r .FRONTEND_ORIGIN)
ENABLE_MOCK_FALLBACK=false
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=20
EOF
chown maternix:maternix .env
chmod 600 .env

# 6. Install production dependencies
npm ci --only=production
chown -R maternix:maternix /home/maternix/app

# 7. Start application via PM2 under maternix user
sudo -u maternix pm2 start backend/server.js --name "maternix-api" -i max
sudo -u maternix pm2 save
pm2 startup systemd -u maternix --hp /home/maternix

# 8. Configure CloudWatch Agent for application logs
cat <<'EOF' > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/home/maternix/.pm2/logs/maternix-api-out.log",
            "log_group_name": "/maternix/production/api",
            "log_stream_name": "{instance_id}-stdout"
          },
          {
            "file_path": "/home/maternix/.pm2/logs/maternix-api-error.log",
            "log_group_name": "/maternix/production/api-error",
            "log_stream_name": "{instance_id}-stderr"
          }
        ]
      }
    }
  }
}
EOF
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
```

---

## 4. Application Load Balancer & Target Group Specifications

| Parameter | Recommended Setting | Justification |
|---|---|---|
| **Protocol & Port** | HTTPS / 443 | All patient and medical data encrypted in transit |
| **SSL/TLS Certificate** | AWS Certificate Manager (ACM) | Automated rotation, free management |
| **Security Policy** | `ELBSecurityPolicy-TLS13-1-2-2021-06` | Enforces modern TLS 1.2 and TLS 1.3 ciphers only |
| **HTTP -> HTTPS Redirect** | Enabled on Port 80 Listener | Prevents accidental plaintext communication |
| **Target Group Protocol** | HTTP / 3000 | Traffic decrypted at ALB; routed over private subnets |
| **Health Check Path** | `/health` | Rapid, non-destructive process liveness endpoint |
| **Health Check Interval** | 15 seconds | Prompt identification of degraded instances |
| **Healthy Threshold** | 2 consecutive successes | Fast onboarding of new scaled instances |
| **Unhealthy Threshold** | 3 consecutive failures | Prevents flapping |
| **Deregistration Delay** | 20 seconds | Allows active requests to drain during scale-in |

---

## 5. Auto Scaling Policies

- **Minimum Capacity**: 2 instances (across 2 separate Availability Zones for high availability)
- **Desired Capacity**: 2 instances
- **Maximum Capacity**: 6 instances
- **Target Tracking Scaling Policy 1 (Traffic)**:
  - Metric: `ALBRequestCountPerTarget`
  - Target value: 1,000 requests per target per minute
- **Target Tracking Scaling Policy 2 (CPU)**:
  - Metric: `CPUUtilization`
  - Target value: 60%
- **Default Cooldown Period**: 180 seconds

---

## 6. Operational Logging with Amazon CloudWatch

### Distinction: CloudWatch vs CloudTrail
- **Amazon CloudWatch**: Operational and diagnostic monitoring (real-time metrics, alarms, application logs, CPU/memory performance, ALB request latency, 5xx error counts).
- **AWS CloudTrail**: Governance, risk, and compliance auditing (records **who** made **which** AWS API call, from what IP address, and when).

### Application Log Collection Strategy
1. The backend prints structured JSON log entries to `stdout`/`stderr`.
2. Sensitive fields (passwords, JWT secrets, patient PII) are strictly omitted from log streams.
3. Every request is tagged with a unique `X-Request-Id` UUID, facilitating end-to-end tracing across distributed components.
4. The CloudWatch Agent forwards logs from `/home/maternix/.pm2/logs/` to `/maternix/production/api`.
5. **Log Retention**: Set to 90 days (or 365 days for healthcare compliance) with KMS encryption enabled (`aws/logs`).

### Recommended CloudWatch Alarms
- **High 5xx Rate**: ALB `HTTPCode_Target_5XX_Count` > 10 in 1 minute.
- **Unhealthy Host Count**: `UnHealthyHostCount` >= 1 for 2 consecutive minutes.
- **High Latency**: ALB `TargetResponseTime` > 0.5s for 3 consecutive minutes.
- **High CPU**: ASG `CPUUtilization` > 80% for 5 minutes.

---

## 7. Security, IAM & Governance

### Principle of Least Privilege: EC2 Instance IAM Role
Create an IAM Role `MaternixEC2InstanceRole` attached to an Instance Profile. Do NOT create IAM users with long-lived secret access keys.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSSMSessionManager",
      "Effect": "Allow",
      "Action": [
        "ssm:UpdateInstanceInformation",
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowCloudWatchLogsForwarding",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/maternix/production/*"
    },
    {
      "Sid": "AllowSecretsManagerDecryption",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:maternix/production-*"
    }
  ]
}
```

### Administrative Shell Access
- **Zero Open Inbound Ports**: Close port 22 (SSH) in the EC2 Security Group.
- **AWS Systems Manager (SSM) Session Manager**: Administrators connect to instances securely through IAM-authenticated SSM sessions. All terminal sessions are logged and audited to CloudWatch.

### CloudTrail Audit Configuration
- Enable multi-region CloudTrail trail logging all Management Events (Read/Write).
- Direct logs to an encrypted S3 bucket with Object Lock and MFA Delete enabled.
- Integrate with Amazon Athena or CloudWatch Logs for audit querying.

---

## 8. Database Layer & Connection Management

1. **Connection Pooling**: When running multiple Node.js instances behind an Auto Scaling Group, direct PostgreSQL connections can rapidly exhaust connection limits. Use **PgBouncer** (Supabase connection pooler on port 6543) or **AWS RDS Proxy** to manage pooled database connections.
2. **Row Level Security (RLS)**: Apply `backend/migrations/01_security_and_rls.sql` to enforce table-level isolation. Ensure the backend server utilizes the `SUPABASE_SERVICE_ROLE_KEY` to query tables as an authorized policy enforcement point.
3. **Database Backups**: Enable automated daily snapshots with Point-In-Time Recovery (PITR) for a 35-day retention period.

---

## 9. Security Checklist Before Public Launch

- [ ] Rotate exposed Supabase keys and create a dedicated production database project.
- [ ] Generate a cryptographically secure random `JWT_SECRET` (>= 32 bytes) stored in AWS Secrets Manager.
- [ ] Execute `01_security_and_rls.sql` in the production PostgreSQL database.
- [ ] Configure custom domain in Route 53 with ACM TLS certificate.
- [ ] Confirm `ENABLE_MOCK_FALLBACK=false` and `NODE_ENV=production` in all production instance environments.
- [ ] Validate ALB target group health check points to `/health`.
- [ ] Set up AWS WAF (Web Application Firewall) on the ALB with AWS Managed Rules (Core rule set, SQLi, Known Bad Inputs).
- [ ] Verify CloudWatch Agent logs ingestion and alarms.
