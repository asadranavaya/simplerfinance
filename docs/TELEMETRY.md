# Telemetry

## Dataset

Every authenticated customer data-plane request emits one row into a dedicated SQLite database. Public authentication calls and administrator endpoints are not part of this dataset. Background operations such as scheduled SimpleFIN sync explicitly emit equivalent impersonated-user rows.

The `service_request_logs` table contains:

| Column | Meaning |
| --- | --- |
| `request_id` | Random UUID generated at request start and returned in `X-Request-ID`. |
| `subscriber_id` | Account ID whose data plane was accessed. |
| `start_time` | UTC ISO timestamp captured before the handler. |
| `latency_ms` | Wall-clock server latency through response completion. |
| `status_code` | HTTP result or mapped background-operation status. |
| `user_type` | `user`, `admin` where applicable, or `impersonated_user` for background work. |
| `method` | HTTP-like operation such as GET, POST, PATCH, PUT, or DELETE. |
| `data_plane_call` | Normalized route label without query-string secrets; identifier-looking segments become `:id`. |
| `counters` | Deduplicated JSON array of bounded `name=integer` strings describing noteworthy work. |

Request IDs are also shown to customers when a 500-class response reaches the frontend, allowing an operator to correlate a report without exposing stack traces.

## Retention

Rows older than seven days are deleted. Purging is triggered at most hourly during writes and by operational maintenance. The database is intentionally disposable and separate from durable finance records. Retention is not guaranteed to be exact to the second, and a stopped server cannot run maintenance.

## Latency dashboard

The admin telemetry page groups samples into UTC hourly buckets and calculates p50, p90, and p99 per method over 24 hours or seven days. Percentiles are calculated from observed request rows, not a persistent histogram sketch. This is accurate for the retained sample set and simple to self-host, but a high-volume installation should use a metrics system designed for bounded-memory aggregation.

Interpret percentiles carefully. A bucket with one request has identical p50/p90/p99 values. Route mix can make a method-level line move even if a particular endpoint is unchanged. Use SQL to separate routes before concluding that the whole service regressed.

## Read-only SQL console

Administrators may submit one `SELECT` or non-recursive `WITH` statement of at most 4,000 characters. Mutating/administrative SQLite keywords, multiple statements, and non-read-only prepared statements are rejected. Results are wrapped and capped at 500 rows.

Examples:

```sql
SELECT method, data_plane_call,
       count(*) AS requests,
       round(avg(latency_ms), 2) AS average_ms
FROM service_request_logs
WHERE start_time >= datetime('now', '-24 hours')
GROUP BY method, data_plane_call
ORDER BY average_ms DESC;
```

```sql
SELECT status_code, count(*) AS requests
FROM service_request_logs
GROUP BY status_code
ORDER BY status_code;
```

```sql
SELECT start_time, request_id, subscriber_id, data_plane_call, counters
FROM service_request_logs
WHERE status_code >= 500
ORDER BY start_time DESC;
```

The SQL guard is defense in depth, not permission to give untrusted people administrator access. Read-only telemetry still exposes account identifiers, operational patterns, and error timing.

## Privacy and trade-offs

The service log avoids request bodies, transaction descriptions, tokens, query strings, user agents, and raw URLs. Subscriber IDs and routes are still personal/operational metadata. Protect the telemetry database like application data, restrict the admin role, and do not export it to a third party without disclosure and a retention policy.
