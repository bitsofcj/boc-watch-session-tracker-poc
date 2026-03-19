# ClickHouse Cost Analysis

Cost estimates for running ClickHouse at the scale described in the PRD — hundreds of thousands of concurrent viewers. All figures are approximate and based on current pricing as of early 2026. Validate against current provider pricing before committing to a budget.

---

## Assumptions

- 300,000 concurrent viewers as a representative "hundreds of thousands" figure
- 30-second heartbeat interval (as stated in the PRD)
- ~10,000 writes/second sustained
- 1 year of event history retained
- Moderate analytical query load from the dashboard (viewer counts, session details)

---

## Self-Hosted ClickHouse on AWS or GCP

ClickHouse is open source and free to run. You pay only for the infrastructure.

### Compute

A single well-provisioned instance handles the write load at this scale comfortably. ClickHouse is designed to saturate hardware efficiently.

| Provider | Service | Spec | Monthly Cost |
|---|---|---|---|
| AWS | EC2 c6i.4xlarge | 16 vCPU / 32GB RAM | ~$490/mo |
| AWS | EC2 c6i.8xlarge | 32 vCPU / 64GB RAM | ~$980/mo |
| GCP | Compute Engine c2-standard-16 | 16 vCPU / 64GB RAM | ~$550/mo |
| GCP | Compute Engine c2-standard-30 | 30 vCPU / 120GB RAM | ~$1,000/mo |

Use compute-optimized instances (AWS `c` series, GCP `c2`) rather than general-purpose — ClickHouse benefits more from CPU and NVMe I/O than raw memory.

### Storage

ClickHouse compresses columnar data extremely well — typically 5–10x better than a row-oriented database like Postgres.

Rough storage estimate for hundreds of thousands of daily active users over one year:
- ~10,000 events/second × 86,400 seconds × 365 days ≈ ~315 billion events/year
- At ~50 bytes per event compressed ≈ ~15TB raw, ~1.5–3TB compressed with ClickHouse columnar compression
- AWS EBS gp3: ~$0.08/GB/month → **~$120–240/month**
- GCP Persistent Disk SSD: ~$0.17/GB/month → **~$255–510/month**

### Total Self-Hosted Estimate

**AWS:**

| Component | Service | Monthly Cost |
|---|---|---|
| ClickHouse | EC2 c6i.4xlarge | ~$490 |
| Block storage (1.5–3TB) | EBS gp3 | ~$120–240 |
| Redis | ElastiCache (r6g.large) | ~$130 |
| Load balancer | ALB | ~$20 |
| Node.js instances (2–4) | EC2 t4g.medium × 4 | ~$100 |
| **Total** | | **~$860–980/mo** |

**GCP:**

| Component | Service | Monthly Cost |
|---|---|---|
| ClickHouse | Compute Engine c2-standard-16 | ~$550 |
| Block storage (1.5–3TB) | Persistent Disk SSD | ~$255–510 |
| Redis | Memorystore (4GB) | ~$150 |
| Load balancer | Cloud Load Balancing | ~$20 |
| Node.js instances (2–4) | Compute Engine e2-medium × 4 | ~$80 |
| **Total** | | **~$1,055–1,310/mo** |

AWS is meaningfully cheaper at this configuration, primarily due to lower EBS storage costs vs GCP Persistent Disk.

---

## ClickHouse Cloud

ClickHouse Cloud is the managed offering. Priced on compute consumed and storage used.

- **Compute**: billed per unit of active processing time — idle time costs very little, but sustained write load at 10,000 events/second means the cluster is rarely idle
- **Storage**: ~$0.023/GB/month — significantly cheaper than self-hosted block storage on either AWS or GCP
- **Egress**: data transfer costs apply for query results leaving the cluster

For hundreds of thousands of concurrent users with moderate analytical query volume:

| Usage tier | Estimated monthly cost |
|---|---|
| Low query volume (dashboard only) | $500–800 |
| Moderate query volume (dashboard + reporting) | $800–1,500 |
| High query volume (ad-hoc analytics) | $1,500–3,000+ |

The upper range is wide because ClickHouse Cloud scales automatically. A single expensive ad-hoc query scanning billions of rows can consume significant compute. This makes budgeting unpredictable compared to self-hosted fixed costs.

---

## Managed Alternatives on AWS / GCP

For teams that want a managed analytics store without self-hosting ClickHouse:

| Solution | Provider | Estimated monthly cost at this scale |
|---|---|---|
| Redshift (batch) | AWS | $1,000–3,000 |
| BigQuery (streaming inserts) | GCP | $1,500–5,000+ |
| Redshift Serverless | AWS | $800–2,500 |
| **ClickHouse Cloud** | Any | **$500–1,500** |
| **ClickHouse self-hosted (AWS)** | AWS EC2 | **~$860–980** |
| **ClickHouse self-hosted (GCP)** | GCP Compute | **~$1,055–1,310** |

ClickHouse is meaningfully cheaper than the managed data warehouse alternatives at this scale, and delivers near real-time query latency that batch pipelines cannot match. BigQuery and Redshift streaming inserts also carry latency of 1–5 minutes, which may not meet the PRD's 10–15 second freshness requirement.

---

## The Cost Cliff to Watch For

**ClickHouse Cloud** becomes expensive when the analytics team runs ad-hoc queries against the full event history — full table scans across hundreds of billions of rows consume compute quickly and the bill spikes unpredictably. This is the primary reason teams at this scale self-host ClickHouse: the hardware cost is fixed regardless of query volume.

**Self-hosted** has its own cost cliff: when you need multi-node clustering for redundancy and failover, you're running 2–3 instances instead of one, doubling or tripling compute cost. At hundreds of thousands of concurrent users a single well-provisioned instance is sufficient; beyond ~1 million concurrent users you'd be looking at a cluster.

---

## Redis Cost Context

Redis is included in the totals above but worth calling out separately since it's the hot-path layer:

| Provider | Service | Spec | Monthly Cost |
|---|---|---|---|
| AWS | ElastiCache (r6g.large) | 13GB RAM | ~$130/mo |
| AWS | ElastiCache (r6g.xlarge) | 26GB RAM | ~$260/mo |
| GCP | Memorystore | 4GB | ~$150/mo |
| GCP | Memorystore | 8GB | ~$250/mo |

At hundreds of thousands of concurrent sessions, active session state in Redis (hashes + TTL) fits comfortably in 4–8GB. Redis is the cheapest component in the stack relative to the load it handles.

---

## Recommendation

For a v1 moving to production, **self-hosted ClickHouse on AWS EC2** is the most cost-effective path. It is:

- Cheaper than ClickHouse Cloud at sustained write load
- Cheaper than BigQuery and Redshift at this event volume
- Predictable — fixed monthly cost regardless of query volume
- Sufficient for hundreds of thousands of concurrent viewers on a single instance
- Directly replaces the legacy hourly batch pipeline with near real-time queries

Move to ClickHouse Cloud or a multi-node self-hosted cluster when operational simplicity outweighs the cost premium, or when the single instance approaches its hardware ceiling.

If FloSports is already committed to GCP, self-hosted on GCP Compute Engine is the equivalent path — slightly higher storage costs but the same architectural approach and operational model.
