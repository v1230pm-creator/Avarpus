import sys

with open('artifacts/mobile/app/(tabs)/index.tsx', 'r') as f:
    content = f.read()

start_idx = content.find("export default function DashboardScreen() {")
end_idx = content.find("  const cardAnims = useRef([...Array(15)]")

if start_idx != -1 and end_idx != -1:
    old_block = content[start_idx:end_idx]
    
    new_block = """export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory, finance, isLoading, loadError, loadAll, hasSampleData } = useData();

  const { data: statsData, refetch: refetchStats } = useDashboardStats({ query: { queryKey: getDashboardStatsQueryKey() } });
  const dashboardStats = statsData?.stats;

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
      await refetchStats();
    } finally {
      setRefreshing(false);
    }
  };

  const hasAnyData = repairs.length > 0 || customers.length > 0 || inventory.length > 0 || finance.length > 0;

  const isDark = useIsDark();
  const today = getTodayStr();

  // For charts
  const stats = useMemo(() => {
    const lowStock = inventory.filter(i => i.quantity <= i.minStock);
    return {
      lowStock: lowStock.length,
    };
  }, [inventory]);

"""
    content = content[:start_idx] + new_block + content[end_idx:]
    with open('artifacts/mobile/app/(tabs)/index.tsx', 'w') as f:
        f.write(content)
else:
    print("Not found")

