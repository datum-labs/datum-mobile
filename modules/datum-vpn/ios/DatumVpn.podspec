Pod::Spec.new do |s|
  s.name           = 'DatumVpn'
  s.version        = '0.1.0'
  s.summary        = 'Datum Connect VPN control (NETunnelProviderManager) for the Datum app'
  s.description    = 'Installs, starts and observes the Datum Connect packet tunnel, and keeps the Connector key in the shared Keychain.'
  s.author         = 'Datum Technology, Inc.'
  s.homepage       = 'https://datum.net'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'NetworkExtension', 'Security', 'CryptoKit'
  s.source_files = '**/*.swift'
end
