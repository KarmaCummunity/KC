# Creates an App Store distribution cert + profile via the ASC API key (runner only).
require 'spaceship'
require 'openssl'
require 'base64'
out = ARGV[0]
Spaceship::ConnectAPI.token = Spaceship::ConnectAPI::Token.create(
  key_id: ENV.fetch('EXPO_ASC_KEY_ID'), issuer_id: ENV.fetch('EXPO_ASC_ISSUER_ID'),
  filepath: ENV.fetch('EXPO_ASC_API_KEY_PATH'))
ident = ENV.fetch('BUNDLE_ID')
bid = Spaceship::ConnectAPI::BundleId.find(ident) ||
      Spaceship::ConnectAPI::BundleId.create(name: 'KC', identifier: ident, platform: 'IOS')
existing = (bid.get_capabilities rescue []).map(&:capability_type)
puts "existing capabilities: #{existing.join(',')}"
{ 'APPLE_ID_AUTH' => [{ key: 'APPLE_ID_AUTH_APP_CONSENT', options: [{ key: 'PRIMARY_APP_CONSENT' }] }],
  'ASSOCIATED_DOMAINS' => [], 'PUSH_NOTIFICATIONS' => [] }.each do |cap, settings|
  next puts("capability #{cap}: already on") if existing.include?(cap)
  begin
    bid.create_capability(cap, settings: settings)
    puts "capability #{cap}: enabled"
  rescue => e
    abort "capability #{cap} failed: #{e.class}: #{e.message[0, 300]}"
  end
end
# Reuse the persistent distribution cert (GitHub secrets KC_IOS_DIST_P12_B64 /
# KC_IOS_DIST_P12_PASSWORD, var KC_IOS_DIST_CERT_ID). The workflow extracts
# dist.p12 into `out` and hands it to EAS as-is. Creating a new cert
# per run hits Apple's distribution-cert limit (409), so never do that here.
cert_id = ENV.fetch('KC_IOS_DIST_CERT_ID')
cert = Spaceship::ConnectAPI::Certificate.all.find { |c| c.id == cert_id }
abort "distribution cert #{cert_id} not found (revoked/expired?) - rotate KC_IOS_DIST_* secrets" unless cert
puts "using certificate: #{cert.id}"
prof = Spaceship::ConnectAPI::Profile.create(name: "KC AppStore #{Time.now.to_i}",
  profile_type: 'IOS_APP_STORE', bundle_id_id: bid.id, certificate_ids: [cert.id])
puts "profile created: #{prof.id}"
File.binwrite(File.join(out, 'kc.mobileprovision'), Base64.decode64(prof.profile_content))
