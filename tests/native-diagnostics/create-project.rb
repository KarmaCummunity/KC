# Diagnostic project only. No target application or KC build dependency.
gem 'xcodeproj', '1.27.0'
require 'xcodeproj'
require 'fileutils'

root = ARGV.fetch(0)
FileUtils.mkdir_p(root)
FileUtils.cp(File.join(__dir__, 'RawAXTests.swift'), File.join(root, 'RawAXTests.swift'))
project = Xcodeproj::Project.new(File.join(root, 'KCAXReader.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'KCAXReader', :ios, '18.0')
target.source_build_phase.add_file_reference(project.main_group.new_file('RawAXTests.swift'))
target.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'org.karmacommunity.diagnostic.axreader'
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  config.build_settings.delete('TEST_TARGET_NAME')
  config.build_settings.delete('TEST_HOST')
end
# A synthetic UIKit application is only for the independent runner's own smoke test.
FileUtils.cp(File.join(__dir__, 'AXControlApp.swift'), File.join(root, 'AXControlApp.swift'))
control = project.new_target(:application, 'KCAXControl', :ios, '18.0')
control.source_build_phase.add_file_reference(project.main_group.new_file('AXControlApp.swift'))
control.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'org.karmacommunity.diagnostic.axcontrol'
  config.build_settings['GENERATE_INFOPLIST_FILE'] = 'YES'
  config.build_settings['SWIFT_VERSION'] = '5.0'
  config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Debug'
scheme.save_as(project.path, 'KCAXReader', true)

control_scheme = Xcodeproj::XCScheme.new
control_scheme.add_build_target(control)
control_scheme.add_build_target(target)
control_scheme.add_test_target(target)
control_scheme.test_action.build_configuration = 'Debug'
control_scheme.test_action.environment_variables = [{ 'key' => 'KC_AX_SMOKE_CONTROL', 'value' => '1', 'enabled' => true }]
control_scheme.save_as(project.path, 'KCAXControlSmoke', true)
