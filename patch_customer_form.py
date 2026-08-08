with open('artifacts/mobile/components/forms/CustomerFormSheet.tsx', 'r') as f:
    content = f.read()

import_target = """      setEmail(customer?.email ?? '');
      setAddress(customer?.address ?? '');"""
import_new = """      setAlternateMobile((customer as any)?.alternateMobile ?? '');
      setEmail(customer?.email ?? '');
      setAddress(customer?.address ?? '');"""
content = content.replace(import_target, import_new)

ui_target = """      <Input label="Mobile *" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" maxLength={10} error={errors.mobile} leftIcon="phone" />"""
ui_new = """      <Input label="Mobile *" value={mobile} onChangeText={setMobile} placeholder="10-digit mobile" keyboardType="phone-pad" maxLength={10} error={errors.mobile} leftIcon="phone" />
      <Input label="Alternate Mobile" value={alternateMobile} onChangeText={setAlternateMobile} placeholder="Optional" keyboardType="phone-pad" maxLength={10} error={errors.alternateMobile} leftIcon="phone" />"""
content = content.replace(ui_target, ui_new)

with open('artifacts/mobile/components/forms/CustomerFormSheet.tsx', 'w') as f:
    f.write(content)
