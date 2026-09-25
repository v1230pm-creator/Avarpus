import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { radius, size, space } from '@/constants/spacing';
import { getTodayStr, isValidDateStr } from '@/utils/helpers';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * The app's date strings are UTC calendar days (see getTodayStr / getNextWeekStr in utils/helpers),
 * so the grid is built with UTC parts and never touches the device's local time zone.
 */
function parseDay(value: string): { y: number; m: number; d: number } | null {
  if (!isValidDateStr(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return { y, m: m - 1, d };
}

function toDateStr(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().split('T')[0];
}

/** Accessibility label of a day cell, e.g. "24 September 2026". */
export function formatDayLabel(value: string): string {
  const p = parseDay(value);
  if (!p) return value;
  return `${p.d} ${MONTH_NAMES[p.m]} ${p.y}`;
}

/** Heading of the month a date belongs to, e.g. "September 2026". */
export function formatMonthTitle(value: string): string {
  const p = parseDay(value);
  if (!p) return value;
  return `${MONTH_NAMES[p.m]} ${p.y}`;
}

function buildWeeks(y: number, m: number): (number | null)[][] {
  const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

interface CalendarDialogProps {
  visible: boolean;
  /** Selected day as YYYY-MM-DD; the dialog opens on its month. */
  value: string;
  /** Earliest / latest selectable day (inclusive), YYYY-MM-DD. */
  minDate?: string;
  maxDate?: string;
  title?: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}

/**
 * Month-grid date picker rendered as a centered dialog. Selecting a day reports it
 * and closes the dialog; days outside [minDate, maxDate] cannot be chosen.
 */
export function CalendarDialog({ visible, value, minDate, maxDate, title = 'Select date', onSelect, onClose }: CalendarDialogProps) {
  const colors = useColors();
  const today = getTodayStr();
  const anchor = parseDay(value) ?? parseDay(today)!;
  const [cursor, setCursor] = useState({ y: anchor.y, m: anchor.m });

  useEffect(() => {
    if (!visible) return;
    const p = parseDay(value) ?? parseDay(getTodayStr())!;
    setCursor({ y: p.y, m: p.m });
  }, [visible, value]);

  const weeks = useMemo(() => buildWeeks(cursor.y, cursor.m), [cursor.y, cursor.m]);

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const next = new Date(Date.UTC(c.y, c.m + delta, 1));
      return { y: next.getUTCFullYear(), m: next.getUTCMonth() };
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close calendar">
        <Pressable style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.iconButton}>
              <Feather name="x" size={size.inlineIcon} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={styles.monthRow}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.iconButton}>
              <Feather name="chevron-left" size={size.statIcon} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.monthTitle, { color: colors.foreground }]}>{`${MONTH_NAMES[cursor.m]} ${cursor.y}`}</Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} accessibilityRole="button" accessibilityLabel="Next month" style={styles.iconButton}>
              <Feather name="chevron-right" size={size.statIcon} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAY_INITIALS.map((w, i) => (
              <View key={`${w}-${i}`} style={styles.cell}>
                <Text style={[styles.weekday, { color: colors.mutedForeground }]}>{w}</Text>
              </View>
            ))}
          </View>

          {weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((day, di) => {
                if (day === null) return <View key={`e-${di}`} style={styles.cell} />;
                const str = toDateStr(cursor.y, cursor.m, day);
                const disabled = (!!minDate && str < minDate) || (!!maxDate && str > maxDate);
                const selected = str === value;
                const isToday = str === today;
                return (
                  <Pressable
                    key={str}
                    disabled={disabled}
                    onPress={() => { onSelect(str); onClose(); }}
                    accessibilityRole="button"
                    accessibilityLabel={formatDayLabel(str)}
                    accessibilityState={{ selected, disabled }}
                    style={styles.cell}
                  >
                    <View
                      style={[
                        styles.day,
                        selected && { backgroundColor: colors.primary },
                        !selected && isToday && { borderWidth: 1.5, borderColor: colors.primary },
                      ]}
                    >
                      <Text
                        style={[
                          selected ? styles.dayTextSelected : styles.dayText,
                          { color: selected ? colors.primaryForeground : disabled ? colors.textDisabled : isToday ? colors.primary : colors.foreground },
                        ]}
                      >
                        {day}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Same scrim as ConfirmDialog so stacked dialogs read as one family.
  backdrop: { flex: 1, backgroundColor: 'rgba(6, 10, 18, 0.72)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 7 * size.avatarSm + 2 * space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...font.overline, flexShrink: 1 },
  iconButton: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center', marginVertical: -space.xs },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { ...font.labelStrong },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, height: size.avatarSm, alignItems: 'center', justifyContent: 'center' },
  weekday: { ...font.small },
  day: { width: size.chip, height: size.chip, borderRadius: size.chip / 2, alignItems: 'center', justifyContent: 'center' },
  dayText: { ...font.caption },
  dayTextSelected: { ...font.captionStrong },
});
