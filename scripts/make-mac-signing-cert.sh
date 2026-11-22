#!/bin/sh
# Makes Orbit's own (free, self-made) Mac code signing certificate. Run it once, then add the two
# values it prints as repository secrets (GitHub → Settings → Secrets and variables → Actions):
#   MAC_SIGNING_CERT           the long base64 text
#   MAC_SIGNING_CERT_PASSWORD  the password
# Every Mac build is then signed by the same identity, so macOS treats updates as the same app
# (no Keychain password prompt and no re-granting permissions after each update). Keep the
# values secret, and don't make a new one later: a new certificate counts as a different app once.
#   sh scripts/make-mac-signing-cert.sh            (or: sh scripts/make-mac-signing-cert.sh out-dir)
set -e
out="${1:-$(mktemp -d)}"
mkdir -p "$out"
pass="$(openssl rand -hex 16)"
cat > "$out/cert.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = Orbit Code Signing
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$out/key.pem" -out "$out/cert.pem" -config "$out/cert.cnf" 2>/dev/null
# macOS's `security import` reads the older pkcs12 format; OpenSSL 3 needs -legacy for it.
openssl pkcs12 -export -legacy -inkey "$out/key.pem" -in "$out/cert.pem" -name "Orbit Code Signing" -out "$out/orbit.p12" -passout "pass:$pass" 2>/dev/null ||
  openssl pkcs12 -export -inkey "$out/key.pem" -in "$out/cert.pem" -name "Orbit Code Signing" -out "$out/orbit.p12" -passout "pass:$pass"
rm -f "$out/key.pem" "$out/cert.cnf"
base64 < "$out/orbit.p12" | tr -d '\n' > "$out/MAC_SIGNING_CERT.txt"
printf '%s' "$pass" > "$out/MAC_SIGNING_CERT_PASSWORD.txt"
echo "Made in $out:"
echo "  MAC_SIGNING_CERT.txt           -> secret MAC_SIGNING_CERT"
echo "  MAC_SIGNING_CERT_PASSWORD.txt  -> secret MAC_SIGNING_CERT_PASSWORD"
