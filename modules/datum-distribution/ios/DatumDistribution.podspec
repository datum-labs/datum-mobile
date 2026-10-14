Pod::Spec.new do |s|
  s.name           = 'DatumDistribution'
  s.version        = '0.1.0'
  s.summary        = 'Tells the app how this binary was distributed'
  s.description    = 'Reports whether the running binary was installed from TestFlight.'
  s.author         = 'Datum Technology, Inc.'
  s.homepage       = 'https://datum.net'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
