import sys

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'r') as f:
    content = f.read()

target = """        {/* Filter Tabs */}"""

new_banner = """
        {/* Offline Sync Banner */}
        {offlineItems.length > 0 && (
          <View style={{ backgroundColor: colors.warning + '22', borderWidth: 1, borderColor: colors.warning + '44', padding: 12, borderRadius: 8, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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
        
        {/* Filter Tabs */}"""

if "Offline Sync Banner" not in content:
    content = content.replace(target, new_banner)

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'w') as f:
    f.write(content)
