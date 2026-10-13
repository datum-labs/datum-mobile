Pod::Spec.new do |s|
  s.name           = 'DatumWidgetsBridge'
  s.version        = '0.1.0'
  s.summary        = 'Shares the health snapshot with the Datum widgets and reloads them'
  s.description    = 'Writes the widget health snapshot to the App Group, reloads WidgetKit timelines and controls, and hands routes from Control Centre controls to the app.'
  s.author         = 'Datum Technology, Inc.'
  s.homepage       = 'https://datum.net'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '26.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'
  s.source_files = '**/*.swift'
end
