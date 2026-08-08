import sys
import re

with open('artifacts/mobile/app/(tabs)/index.tsx', 'r') as f:
    content = f.read()

# Using regex to replace the entire DashboardScreen down to anims because literal string replace failed.
pattern = re.compile(r'export default function DashboardScreen\(\) \{.*?(?=  const anims = useStaggerAnim\(8\);)', re.DOTALL)

new_content = """export default function DashboardScreen() {
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

content = pattern.sub(new_content, content)
with open('artifacts/mobile/app/(tabs)/index.tsx', 'w') as f:
    f.write(content)
