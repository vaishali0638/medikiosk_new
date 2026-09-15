# Certificate authorities

## `supabase-prod-ca-2021.crt`

Supabase signs its Postgres certificates with its own root, which is not in Node's trust
store — so a connection fails with `self-signed certificate in certificate chain`. The
usual internet answer to that error is `rejectUnauthorized: false`, which does not fix the
problem, it removes the check: the connection stays encrypted and stops being authenticated,
and a network able to intercept it can read every patient record that crosses it.

This is the alternative: trust that one CA and keep verifying everything.

Downloaded from Supabase's published location and checked against the root the server
actually presents:

    https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

    subject  C=US, ST=Delware, L=New Castle, O=Supabase Inc, CN=Supabase Root 2021 CA
    sha256   80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA

Verify it yourself before trusting this file — the point of a CA is that you checked it:

```bash
openssl x509 -in infra/certs/supabase-prod-ca-2021.crt -noout -subject -fingerprint -sha256

openssl s_client -starttls postgres -connect db.<ref>.supabase.co:5432 -showcerts </dev/null 2>/dev/null \
  | awk '/BEGIN CERT/{n++} n==3' | openssl x509 -noout -fingerprint -sha256
```

The two fingerprints must be identical.

A certificate is public. There is no secret in this file.
