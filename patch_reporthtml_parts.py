with open('artifacts/mobile/utils/reportHtml.ts', 'r') as f:
    content = f.read()

# Add stockMovements to ReportData interface
target_interface = """export interface ReportData {
  repairs: Repair[];
  customers: Customer[];
  inventory: InventoryItem[];
  purchases: Purchase[];
  finance: FinanceEntry[];
  staff: StaffMember[];
  refunds?: any[];
  shopName?: string;
}"""
new_interface = """export interface ReportData {
  repairs: Repair[];
  customers: Customer[];
  inventory: InventoryItem[];
  purchases: Purchase[];
  finance: FinanceEntry[];
  staff: StaffMember[];
  refunds?: any[];
  stockMovements?: any[];
  shopName?: string;
}"""
content = content.replace(target_interface, new_interface)

# Update partsConsumptionReport to use stockMovements
target_parts = """function partsConsumptionReport(d: ReportData): ReportTable {
  // Aggregate parts from repairs data
  const partsMap = new Map<string, number>();
  d.repairs.forEach((r) => {
    if (r.parts && Array.isArray(r.parts)) {
      r.parts.forEach((p: any) => {
        if (p.name) {
          const qty = parseInt(p.quantity) || 1;
          partsMap.set(p.name, (partsMap.get(p.name) || 0) + qty);
        }
      });
    }
  });"""
new_parts = """function partsConsumptionReport(d: ReportData): ReportTable {
  const partsMap = new Map<string, number>();
  
  if (d.stockMovements) {
    d.stockMovements.forEach((m) => {
      // Look for negative quantity change indicating consumption
      if (m.quantityChange < 0 && m.itemName) {
        const qty = Math.abs(m.quantityChange);
        partsMap.set(m.itemName, (partsMap.get(m.itemName) || 0) + qty);
      }
    });
  }"""
content = content.replace(target_parts, new_parts)

with open('artifacts/mobile/utils/reportHtml.ts', 'w') as f:
    f.write(content)
