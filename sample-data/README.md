# Sanitized Sample Data

Prepared for: Joe Vogle
Prepared by: Chris Hughes
Date: 2026-07-24

## What this is

Three sanitized sample datasets drawn from real GrowthZone tenant exports. They
are provided so you can build and test against realistic data shapes, column
names, data types, and record relationships without ever touching production PII.

All personally identifiable information has been masked or tokenized. These are
samples (a few hundred rows each), not full extracts.

## Files

| File | Source shape | Rows (sampled / total) | Columns |
|------|--------------|------------------------|---------|
| `ctat_membership_sample_sanitized.csv` | Member / constituent records (YourMembership-style export) | 300 / 10,120 | 102 |
| `sior_events_sample_sanitized.csv` | Event catalog (MemberSuite export) | 300 / 3,643 | 14 |
| `sior_persons_aop_sample_sanitized.csv` | Person-to-topic association records | 300 / 85,333 | 7 |
| `SampleTenantDB.bak` | SQL Server 2022 backup of all three tables (`dbo.CTAT_Membership`, `dbo.SIOR_Events`, `dbo.SIOR_Persons_AOP`), typed columns | 900 rows total | — |

## Restoring the .bak

`SampleTenantDB.bak` is a native SQL Server 2022 (Developer edition) backup. The
three CSVs above were loaded into typed `dbo` tables (inferred INT / DATETIME2 /
NVARCHAR columns), then backed up. It restores on SQL Server 2022 or newer.

```sql
RESTORE FILELISTONLY FROM DISK = '/path/to/SampleTenantDB.bak';  -- see logical names

RESTORE DATABASE [SampleTenantDB]
  FROM DISK = '/path/to/SampleTenantDB.bak'
  WITH MOVE 'SampleTenantDB'     TO '/var/opt/mssql/data/SampleTenantDB.mdf',
       MOVE 'SampleTenantDB_log' TO '/var/opt/mssql/data/SampleTenantDB_log.ldf',
       REPLACE;
```

On Docker: `docker cp SampleTenantDB.bak <container>:/var/opt/mssql/backup/` then run
the restore above via `sqlcmd`. Verified restorable and PII-clean before delivery
(0 non-fake emails, 0 real passwords in the restored data).

Column names, ordering, and data types match the production exports exactly. Only
the values have been sanitized. Empty cells are genuine: they reflect the real
sparsity of the source data, not sanitization.

## Sanitization method: masked / tokenized

Every PII value was replaced with an opaque, non-real placeholder. Replacement is
stable per column: the same original value always maps to the same token, so
uniqueness, cardinality, and within-file joins are preserved. You cannot reverse a
token back to a real value.

### Masking conventions

| Field type | Treatment | Example output |
|------------|-----------|----------------|
| Person names (first, last, middle, nickname, maiden, spouse) | Stable token per name | `First00042`, `Last00042` |
| Usernames | Stable token | `user_00042` |
| Passwords | Hard redacted, never tokenized | `[REDACTED]` |
| Email addresses | Fake, RFC-safe `.invalid` domain | `user00042@example.invalid` |
| Phone / mobile / fax numbers | Masked subscriber number, kept phone-shaped | `5550042` |
| Street address lines | Bracketed token | `[ADDR1_00042]` |
| Postal / ZIP codes | Truncated to first 3 chars + `XX` | `770XX` |
| Personal websites / employer websites | Fake `.invalid` URL | `https://example.invalid/p00042` |
| Employer / organization names | Bracketed token | `[ORG_00042]` |
| Birthdate / anniversary date | Generalized to year only (Jan 1) | `1984-01-01` |
| API GUIDs / record identifiers | Regenerated synthetic values | new UUID / sequential ID |
| Free-text fields (internal comments, resume headline, education, personal info, social orgs) | Fully redacted | `[REDACTED_FREETEXT]` |
| Cert / member numbers (e.g. ACTE) | Stable token | `ACTE000042` |

### Kept as-is (non-identifying, useful for building)

City, state/province, country, gender, age range, professional title, profession,
membership type and group codes, all status and boolean flags, and all
operational/system dates (registration, approval, last login, membership expiry,
last renewed, etc.). A regex scrub still ran over every one of these columns to
strip any stray email, phone, SSN, or card number that might have been embedded in
free text.

## Guarantees

- No real names, emails, phone numbers, street addresses, passwords, or free-text
  personal notes remain.
- No Social Security numbers or payment card / bank account numbers are present
  (verified by pattern scan across all output; zero hits).
- Full ZIP codes, exact birthdates, and exact street addresses are not recoverable.
- Every output file passed an automated residual-PII scan before delivery.

## Notes for building

- Tokens preserve relationships. Two rows sharing the same original employer share
  the same `[ORG_x]` token, so grouping and join logic will behave realistically.
- The person-to-topic file (`sior_persons_aop`) is a classic many-to-many
  association table: one member (`Entity ID`) maps to many topic codes.
- If you need a larger sample, more tables, or the full column-level data
  dictionary with types, let me know what the build needs and I will extend the
  package.
