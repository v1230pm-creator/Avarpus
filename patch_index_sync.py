import sys

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'r') as f:
    content = f.read()

import_target = "import { formatDate, formatCurrency, getReturnStatusColor } from '@/utils/helpers';"
import_new = """import { formatDate, formatCurrency, getReturnStatusColor } from '@/utils/helpers';
import * as Network from 'expo-network';
import { offlineQueue, QueuedRepair } from '@/utils/offlineQueue';
import { useQueryClient } from '@tanstack/react-query';"""

content = content.replace(import_target, import_new)

state_target = "  const [accumulatedRepairs, setAccumulatedRepairs] = useState<Repair[]>([]);"
state_new = """  const [accumulatedRepairs, setAccumulatedRepairs] = useState<Repair[]>([]);
  
  const queryClient = useQueryClient();
  const [offlineItems, setOfflineItems] = useState<QueuedRepair[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  const loadOfflineQueue = async () => {
    const q = await offlineQueue.getQueue();
    setOfflineItems(q);
  };

  const handleSync = async () => {
    if (isSyncing || offlineItems.length === 0) return;
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected) return;
    
    setIsSyncing(true);
    const { success, failed } = await offlineQueue.flush();
    setIsSyncing(false);
    await loadOfflineQueue();
    if (success > 0) {
      setPage(1);
      queryClient.invalidateQueries();
    }
  };

  React.useEffect(() => {
    loadOfflineQueue();
    Network.getNetworkStateAsync().then(state => setIsConnected(!!state.isConnected));
  }, []);"""

content = content.replace(state_target, state_new)

sync_banner_target = "{/* Filters */}"
sync_banner_new = """
        {/* Offline Sync Banner */}
        {offlineItems.length > 0 && (
          <View style={{ backgroundColor: colors.warning + '22', borderWidth: 1, borderColor: colors.warning + '44', padding: 12, borderRadius: 8, marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, color: colors.warning, fontFamily: 'Inter_600SemiBold' }}>
                {offlineItems.length} repair{offlineItems.length > 1 ? 's' : ''} saved offline
              </Text>
              <Text style={{ fontSize: 12, color: colors.warning, marginTop: 2 }}>
                Photos/signatures will need to be re-added once synced.
              </Text>
              {offlineItems.some(i => i.status === 'failed') && (
                <Text style={{ fontSize: 11, color: colors.destructive, marginTop: 2 }}>
                  Some items failed to sync due to errors.
                </Text>
              )}
            </View>
            <TouchableOpacity 
              onPress={handleSync} 
              disabled={isSyncing || !isConnected}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: (isSyncing || !isConnected) ? colors.muted : colors.warning, borderRadius: 6 }}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                  {isConnected ? 'Sync Now' : 'Offline'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        
        {/* Filters */}"""

content = content.replace(sync_banner_target, sync_banner_new)

refresh_target = """  const onRefresh = async () => {
    setPage(1);
    await returnsRefetch();"""
refresh_new = """  const onRefresh = async () => {
    setPage(1);
    await loadOfflineQueue();
    await handleSync();
    await returnsRefetch();"""

content = content.replace(refresh_target, refresh_new)

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'w') as f:
    f.write(content)
