/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

export const PPL_REFERENCE = `# OpenSearch PPL (Piped Processing Language) Reference

## Query Structure
source=<index-pattern> | command1 | command2 | ...

## Commands

### source (REQUIRED first clause)
source=my-index                    — single index
source=logs-*                      — wildcard pattern
source=logs-otel-v1-*              — OTel logs

### where — filter rows
| where age > 18
| where status = 'ERROR'
| where name like '%test%'
| where timestamp >= '2026-01-19 05:44:00.000' and timestamp <= '2026-01-20 05:44:00.000'
| where isnotnull(field)
| where field IN ('val1', 'val2')

### fields — select/remove fields
| fields timestamp, message, status       — keep only these
| fields - unwantedField                  — remove field

### stats — aggregation
| stats count()                           — total count
| stats count() by status                 — group by
| stats count() as cnt by status          — named alias
| stats avg(latency) as avgLatency by service
| stats sum(bytes), max(bytes), min(bytes) by host
| stats dc(userId) as uniqueUsers         — distinct count
| stats percentile(latency, 99) as p99

### sort — order results
| sort timestamp                          — ascending
| sort - timestamp                        — descending (most recent first)
| sort - count()                          — sort by aggregation desc

### head — limit results
| head 100                                — first 100 rows (default 10)
| head 50 from 10                         — 50 rows starting from offset 10

### dedup — remove duplicates
| dedup serviceName                       — keep first occurrence
| dedup 2 serviceName                     — keep first 2 per value

### eval — computed fields
| eval total = price * quantity
| eval status_group = if(status >= 400, 'error', 'success')
| eval duration_ms = duration * 1000

### rename — rename fields
| rename oldName as newName

### top — most common values
| top 10 serviceName                      — top 10 service names
| top 5 status by host                    — top 5 statuses per host

### rare — least common values
| rare 10 errorCode

### parse — regex extraction
| parse message '(?<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)' 

## Aggregation Functions
count(), sum(f), avg(f), max(f), min(f), dc(f), percentile(f,p), stddev(f), var_pop(f)

## String Functions
lower(s), upper(s), trim(s), ltrim(s), rtrim(s), substring(s,start,len), concat(s1,s2), length(s), replace(s,old,new), like(s,pattern)

## Date Functions
now(), curdate(), year(d), month(d), day(d), hour(d), minute(d), second(d), date_format(d,fmt), datediff(d1,d2), date_add(d,interval), date_sub(d,interval)

## Math Functions
abs(n), ceil(n), floor(n), round(n,d), pow(b,e), sqrt(n), log(n), log2(n), log10(n)

## Condition Functions
if(cond, true_val, false_val), ifnull(f, default), isnull(f), isnotnull(f), nullif(f1, f2), case(when cond then val ... else default end)

## Common Patterns

### Log exploration
source=logs-* | where severityText = 'ERROR' | sort - @timestamp | head 100

### Aggregation dashboard
source=logs-* | stats count() as total, dc(serviceName) as services by severityText

### Time-filtered query
source=logs-* | where @timestamp >= '2026-04-30 00:00:00.000' | sort - @timestamp | head 200

### Top errors by service
source=logs-* | where severityText = 'ERROR' | stats count() as errors by serviceName | sort - errors | head 10
`;
