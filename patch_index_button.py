with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'r') as f:
    content = f.read()

target = """                <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>New</Text>
              </TouchableOpacity>
            )}
          </View>"""

new_content = """                <Text style={[styles.addBtnText, { fontFamily: 'Inter_600SemiBold' }]}>New</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/repairs/scanner')}
              activeOpacity={0.85}
              style={[styles.addBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 }]}
            >
              <Feather name="maximize" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>"""

content = content.replace(target, new_content)

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'w') as f:
    f.write(content)
