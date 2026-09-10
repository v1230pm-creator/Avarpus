import { ReactNode } from 'react';
import {
  Wifi, Battery, Search, ArrowLeft, MessageCircle, Phone,
  Store, MoreHorizontal, User, Users, Briefcase, Wrench,
  ShieldCheck, Camera, Check, CircleDashed, ChevronRight,
  Plus, Settings, Bell, FileText, IndianRupee, PieChart,
  Package, Mic, Paperclip, Smartphone
} from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import splashMark from '../../../../mobile/assets/images/avarpus-splash-mark.png';

const AVARPUS_BLUE = '#006DA8';

export function DeviceMockup({ children, className = '' }: { children: ReactNode, className?: string }) {
  return (
    <div className={`relative mx-auto border-[#1a1a1c] bg-[#1a1a1c] border-[8px] sm:border-[10px] rounded-[2.5rem] sm:rounded-[3rem] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.1)_inset] shrink-0 ${className} ring-1 ring-white/10 dark:ring-white/5`}>
      <div className="absolute -left-[10px] sm:-left-[12px] top-[100px] w-[2px] sm:w-[3px] h-[26px] bg-[#2a2a2c] rounded-l-sm shadow-[inset_1px_0_1px_rgba(255,255,255,0.2)]" />
      <div className="absolute -left-[10px] sm:-left-[12px] top-[140px] w-[2px] sm:w-[3px] h-[50px] bg-[#2a2a2c] rounded-l-sm shadow-[inset_1px_0_1px_rgba(255,255,255,0.2)]" />
      <div className="absolute -left-[10px] sm:-left-[12px] top-[200px] w-[2px] sm:w-[3px] h-[50px] bg-[#2a2a2c] rounded-l-sm shadow-[inset_1px_0_1px_rgba(255,255,255,0.2)]" />
      <div className="absolute -right-[10px] sm:-right-[12px] top-[160px] w-[2px] sm:w-[3px] h-[60px] bg-[#2a2a2c] rounded-r-sm shadow-[inset_-1px_0_1px_rgba(255,255,255,0.2)]" />

      <div className="relative w-full h-full bg-background overflow-hidden flex flex-col rounded-[2rem] sm:rounded-[2.4rem] isolate ring-1 ring-black/10 dark:ring-white/10">
        <div className="absolute left-1/2 top-3 sm:top-4 z-[60] h-3 w-3 sm:h-3.5 sm:w-3.5 -translate-x-1/2 rounded-full bg-[#0a0a0a] shadow-[inset_0_-1px_2px_rgba(255,255,255,0.15)] ring-1 ring-white/5" />
        {children}
        <div className="pointer-events-none absolute inset-0 z-50 rounded-[2rem] sm:rounded-[2.4rem] bg-gradient-to-tr from-transparent via-white/[0.02] to-white/[0.1] mix-blend-overlay" />
      </div>
    </div>
  );
}

function MockupStatusBar({ dark = false }: { dark?: boolean }) {
  const color = dark ? 'text-white' : 'text-foreground';
  return (
    <div className="h-10 sm:h-12 flex justify-between items-center px-5 sm:px-6 pt-2 sm:pt-3 bg-transparent z-40 shrink-0">
      <span className={`text-[11px] sm:text-xs font-semibold tracking-wide ${color}`}>9:41</span>
      <div className="flex gap-1.5 items-center">
        <Wifi className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${color}`} />
        <Battery className={`w-4 h-4 sm:w-5 sm:h-5 ${color}`} />
      </div>
    </div>
  );
}

function MockupTabBar({ active }: { active: string }) {
  const tabs = [
    { id: 'chat', label: 'Chat', icon: MessageCircle },
    { id: 'status', label: 'Status', icon: CircleDashed },
    { id: 'shop', label: 'Shop', icon: Briefcase },
    { id: 'calls', label: 'Calls', icon: Phone },
    { id: 'repairs', label: 'Repairs', icon: Wrench },
  ];

  return (
    <div className="h-14 sm:h-16 border-t border-border bg-card/90 backdrop-blur-md flex items-center justify-around px-2 sm:px-4 pb-2 sm:pb-3 shrink-0 z-40 absolute bottom-0 left-0 right-0">
      {tabs.map(tab => {
        const isActive = active === tab.id;
        const Icon = tab.icon;
        return (
          <div key={tab.id} className="flex flex-col items-center justify-center gap-1 flex-1 h-full pt-2">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${isActive ? 'bg-primary/10' : 'bg-transparent'}`}>
              <Icon className={`w-5 h-5 sm:w-5 sm:h-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <span className={`text-[9px] sm:text-[10px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {tab.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SplashScreen() {
  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-8 h-full w-full"
      style={{ backgroundColor: AVARPUS_BLUE }}
    >
      <style>{`
        @keyframes avarpus-letter-wave {
          0% { opacity: 0; transform: translate(-14px, -18px) scale(.82); }
          55% { opacity: .72; transform: translate(-5px, 8px) scale(.94); }
          100% { opacity: 1; transform: translate(0, 0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .avarpus-splash-letter { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>
      <div className="relative z-10 flex flex-col items-center">
        <div className="relative h-28 w-28 sm:h-36 sm:w-36">
          <img src={splashMark} alt="Avarpus" className="absolute inset-0 h-full w-full object-contain" />
        </div>
        <div className="mt-1 flex" aria-label="Avarpus">
          {'Avarpus'.split('').map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              className="avarpus-splash-letter inline-block text-[28px] font-semibold tracking-[2.2px] text-white opacity-0 sm:text-[32px]"
              style={{
                animation: 'avarpus-letter-wave 580ms ease-out forwards',
                animationDelay: `${900 + index * 125}ms`,
                textShadow: '0 0 16px rgba(255,255,255,.22)',
              }}
            >
              {letter}
            </span>
          ))}
        </div>
        <p className="mt-2 text-center text-[8px] font-semibold tracking-[2px] text-white/85 sm:text-[9px]">
          SECURE · PRIVATE · CONNECTED
        </p>
      </div>
    </div>
  );
}

export function ChatListScreen() {
  return (
    <div className="flex-1 bg-background flex flex-col font-sans h-full relative">
      <MockupStatusBar />
      <div className="px-4 py-2 sm:py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-primary font-bold text-sm">A</span>
          </div>
          <span className="text-lg sm:text-xl font-bold text-foreground">Avarpus</span>
        </div>
        <div className="flex gap-3">
          <Camera className="w-5 h-5 text-foreground" />
          <MoreHorizontal className="w-5 h-5 text-foreground" />
        </div>
      </div>

      <div className="px-4 py-2 shrink-0">
        <div className="bg-muted/50 rounded-xl h-9 flex items-center px-3 gap-2 border border-border">
          <Search className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Search conversations</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-20 flex flex-col gap-4">
        <ChatItem name="Rahul Service Center" text="I have sent the spare parts." time="10:24" unread={2} avatar="RS" />
        <ChatItem name="Avarpus Official" text="Your business profile is ready." time="09:15" unread={1} avatar="AV" />
        <ChatItem name="Priya Customer" text="Photo" time="08:40" icon={<Camera className="w-3 h-3 text-muted-foreground" />} avatar="PC" />
        <ChatItem name="Technician Aman" text="Repair completed for job #420" time="Yesterday" avatar="TA" />
        <ChatItem name="Amit Mobile Point" text="Thanks!" time="Yesterday" readReceipt avatar="AM" />
        <ChatItem name="Supplier Wholesale" text="New stock arrived" time="Monday" avatar="SW" />
      </div>
      <MockupTabBar active="chat" />
    </div>
  );
}

export function StatusScreen() {
  const updates = [
    { initials: 'AV', name: 'Avarpus Official', time: 'Today, 10:28 AM', accent: 'bg-primary' },
    { initials: 'RS', name: 'Rahul Service Center', time: 'Today, 9:42 AM', accent: 'bg-orange-500' },
    { initials: 'PC', name: 'Priya Customer', time: 'Yesterday, 8:15 PM', accent: 'bg-emerald-500' },
    { initials: 'AM', name: 'Amit Mobile Point', time: 'Yesterday, 6:30 PM', accent: 'bg-violet-500' },
  ];

  return (
    <div className="flex-1 bg-background flex flex-col font-sans h-full relative">
      <MockupStatusBar />
      <div className="px-4 py-2 sm:py-3 flex items-center justify-between shrink-0">
        <span className="text-lg sm:text-xl font-bold text-foreground">Status</span>
        <div className="flex gap-3">
          <Search className="w-5 h-5 text-foreground" />
          <MoreHorizontal className="w-5 h-5 text-foreground" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-20">
        <div className="flex items-center gap-3 py-3 border-b border-border">
          <div className="relative w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center border border-border">
            <span className="text-sm font-bold text-primary">A</span>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground border-2 border-background flex items-center justify-center">
              <Plus className="w-3 h-3" />
            </div>
          </div>
          <div>
            <h4 className="text-[15px] font-semibold text-foreground">My status</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Tap to add a status update</p>
          </div>
        </div>

        <p className="pt-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Recent updates
        </p>
        <div className="flex flex-col">
          {updates.map((update) => (
            <div key={update.name} className="flex items-center gap-3 py-3 border-b border-border/50">
              <div className={`w-12 h-12 rounded-full p-[2px] ${update.accent}`}>
                <div className="w-full h-full rounded-full bg-background p-[2px]">
                  <div className="w-full h-full rounded-full bg-muted flex items-center justify-center">
                    <span className="text-xs font-bold text-foreground">{update.initials}</span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-[14px] font-semibold text-foreground">{update.name}</h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">{update.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <MockupTabBar active="status" />
    </div>
  );
}

function ChatItem({ name, text, time, unread, isVerified, icon, readReceipt, avatar }: any) {
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-accent flex items-center justify-center shrink-0 border border-border relative">
        <span className="text-sm font-bold text-foreground/70">{avatar}</span>
        {isVerified && (
          <div className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#21C063]" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 border-b border-border/40 pb-3">
        <div className="flex justify-between items-baseline mb-0.5">
          <span className="font-semibold text-foreground text-[15px] truncate">{name}</span>
          <span className={`text-[10px] sm:text-[11px] ${unread ? 'text-[#21C063] font-semibold' : 'text-muted-foreground'} shrink-0 ml-2`}>{time}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {readReceipt && <Check className="w-3.5 h-3.5 text-[#53BDEB] shrink-0" />}
          {icon}
          <span className={`text-[13px] sm:text-[14px] truncate ${unread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{text}</span>
        </div>
      </div>
      {unread && (
        <div className="w-5 h-5 rounded-full bg-[#21C063] flex items-center justify-center shrink-0 mb-3">
          <span className="text-[10px] font-bold text-white leading-none">{unread}</span>
        </div>
      )}
    </div>
  );
}

export function ChatRoomScreen() {
  return (
    <div className="flex-1 bg-[#efeae2] dark:bg-[#0b141a] flex flex-col font-sans h-full relative">
      <div className="bg-background z-40 shrink-0 shadow-sm">
        <MockupStatusBar />
        <div className="px-2 py-2 flex items-center gap-2">
          <ArrowLeft className="w-5 h-5 text-foreground" />
          <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-foreground/70">TA</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-foreground text-sm truncate">Technician Aman</div>
            <div className="text-[10px] text-muted-foreground">online</div>
          </div>
          <Phone className="w-4 h-4 text-foreground mx-2" />
          <MoreHorizontal className="w-5 h-5 text-foreground ml-1 mr-2" />
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-3 py-4 flex flex-col gap-3 z-10 opacity-90 mix-blend-multiply dark:mix-blend-screen" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%239C92AC' fill-opacity='0.1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='3'/%3E%3Ccircle cx='13' cy='13' r='3'/%3E%3C/g%3E%3C/svg%3E")` }}>
      </div>
      <div className="absolute inset-0 flex flex-col gap-3 px-3 pt-[100px] z-20 pb-20 overflow-y-auto overscroll-contain">
        <div className="self-center bg-background/80 backdrop-blur px-3 py-1 rounded-lg text-[10px] text-foreground/70 mb-2 font-medium">Today</div>

        <ChatMessage isOut text="Did you finish the screen replacement for the S21?" time="10:15" />
        <ChatMessage isIn text="Yes, it's done. Testing the display now." time="10:18" />
        <ChatMessage isIn text="Looks perfect." time="10:18" />
        <ChatMessage isOut text="Great! Update the repair status to ready." time="10:20" />
        <ChatMessage isIn text="Done." time="10:25" />
      </div>

      <div className="p-2 bg-transparent flex gap-2 items-end shrink-0 z-40 relative pb-4">
        <div className="flex-1 bg-background rounded-2xl flex items-center px-3 py-2 min-h-[40px] shadow-sm">
          <span className="text-muted-foreground text-[13px] flex-1">Message...</span>
          <Paperclip className="w-4 h-4 text-muted-foreground ml-2" />
          <Camera className="w-4 h-4 text-muted-foreground ml-3" />
        </div>
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-sm">
          <Mic className="w-4 h-4 text-primary-foreground" />
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ isOut, text, time }: { isOut?: boolean, isIn?: boolean, text: string, time: string }) {
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-xl px-3 py-1.5 shadow-sm relative ${isOut ? 'bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-sm' : 'bg-card rounded-tl-sm'}`}>
        <p className={`text-[13px] sm:text-[14px] leading-snug ${isOut ? 'text-[#111b21] dark:text-[#e9edef]' : 'text-foreground'}`}>{text}</p>
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className={`text-[9px] ${isOut ? 'text-[#667781] dark:text-[#8696a0]' : 'text-muted-foreground'}`}>{time}</span>
          {isOut && <Check className="w-3 h-3 text-[#53BDEB]" />}
        </div>
      </div>
    </div>
  );
}

export function ShopScreen() {
  return (
    <div className="flex-1 bg-muted/30 flex flex-col font-sans h-full relative">
      <div className="bg-primary pb-4 shrink-0 rounded-b-2xl shadow-sm z-10 relative">
        <div className="text-primary-foreground">
          <MockupStatusBar dark />
        </div>
        <div className="px-4 py-2 flex items-center justify-between">
          <span className="text-lg font-bold text-primary-foreground">Avarpus Hub</span>
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-primary-foreground" />
            <Settings className="w-5 h-5 text-primary-foreground" />
          </div>
        </div>
        <div className="px-4 mt-2">
          <div className="bg-white/10 rounded-xl p-4 flex items-center gap-3 border border-white/20 backdrop-blur-sm">
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-sm">
              <Store className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-primary-foreground text-sm">Rahul Mobile Repair</h4>
              <p className="text-xs text-primary-foreground/90 mt-0.5 font-medium">Repair business workspace</p>
            </div>
            <ChevronRight className="w-5 h-5 text-primary-foreground/70" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-20 flex flex-col gap-4 relative z-0">
        <div className="grid grid-cols-2 gap-3">
          <StatCard title="Active Repairs" value="12" icon={<Wrench className="w-4 h-4 text-orange-500" />} />
          <StatCard title="Today's Earnings" value="₹4,500" icon={<IndianRupee className="w-4 h-4 text-green-500" />} />
        </div>

        <h5 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-2 ml-1">Quick Tools</h5>
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <ToolRow icon={<Wrench className="w-4 h-4 text-primary" />} title="Manage Repairs" detail="Track status and updates" />
          <ToolRow icon={<Users className="w-4 h-4 text-primary" />} title="Customers" detail="View directory and history" />
          <ToolRow icon={<FileText className="w-4 h-4 text-primary" />} title="Khata (Ledger)" detail="Manage balances and dues" />
          <ToolRow icon={<Package className="w-4 h-4 text-primary" />} title="Inventory" detail="Check parts and stock" isLast />
        </div>
      </div>

      <MockupTabBar active="shop" />
    </div>
  );
}

function StatCard({ title, value, icon }: any) {
  return (
    <div className="bg-card rounded-xl p-3 border border-border shadow-sm flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center shrink-0">
          {icon}
        </div>
        <span className="text-[10px] font-semibold text-muted-foreground line-clamp-1">{title}</span>
      </div>
      <span className="text-lg font-bold text-foreground">{value}</span>
    </div>
  );
}

function ToolRow({ icon, title, detail, isLast }: any) {
  return (
    <div className={`flex items-center gap-3 p-3 ${!isLast ? 'border-b border-border/50' : ''}`}>
      <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1">
        <h6 className="text-[13px] font-bold text-foreground">{title}</h6>
        <p className="text-[10px] text-muted-foreground">{detail}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </div>
  );
}

export function RepairsScreen() {
  return (
    <div className="flex-1 bg-background flex flex-col font-sans h-full relative">
      <MockupStatusBar />
      <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
        <span className="text-lg font-bold text-foreground">Repairs</span>
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow-sm">
          <Plus className="w-4 h-4 text-primary-foreground" />
        </div>
      </div>

      <div className="flex px-4 mt-2 border-b border-border shrink-0">
        <div className="flex-1 pb-2 border-b-2 border-primary text-center">
          <span className="text-xs font-bold text-primary">Active (12)</span>
        </div>
        <div className="flex-1 pb-2 text-center">
          <span className="text-xs font-semibold text-muted-foreground">Ready (3)</span>
        </div>
        <div className="flex-1 pb-2 text-center">
          <span className="text-xs font-semibold text-muted-foreground">Done</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-20 flex flex-col gap-3">
        <RepairItem brand="Samsung" model="Galaxy S21" issue="Screen Broken" status="In Progress" time="Due Today" id="#420" color="bg-blue-500" />
        <RepairItem brand="Apple" model="iPhone 12" issue="Battery Replacement" status="Waiting for Part" time="Due Tomorrow" id="#421" color="bg-orange-500" />
        <RepairItem brand="OnePlus" model="Nord 2" issue="Not Charging" status="Diagnostic" time="Due Today" id="#422" color="bg-purple-500" />
        <RepairItem brand="Xiaomi" model="Redmi Note 10" issue="Speaker Issue" status="In Progress" time="Due in 2 days" id="#423" color="bg-blue-500" />
      </div>

      <MockupTabBar active="repairs" />
    </div>
  );
}

function RepairItem({ brand, model, issue, status, time, id, color }: any) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-sm flex flex-col gap-2">
      <div className="flex justify-between items-start">
        <div className="flex gap-2 items-center">
          <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-foreground leading-tight">{brand} {model}</h4>
            <span className="text-[10px] text-muted-foreground">{id} • {issue}</span>
          </div>
        </div>
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-accent text-muted-foreground">{time}</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${color}`} />
          <span className="text-[11px] font-semibold text-foreground">{status}</span>
        </div>
        <div className="flex -space-x-1">
          <div className="w-5 h-5 rounded-full bg-accent border border-card flex items-center justify-center z-10"><span className="text-[8px] font-bold text-foreground">TA</span></div>
        </div>
      </div>
    </div>
  );
}

export function KhataScreen() {
  return (
    <div className="flex-1 bg-background flex flex-col font-sans h-full relative">
      <MockupStatusBar />
      <div className="px-4 py-2 border-b border-border flex items-center gap-3 shrink-0">
        <ArrowLeft className="w-5 h-5 text-foreground" />
        <span className="text-lg font-bold text-foreground">Khata</span>
      </div>

      <div className="px-4 py-4 shrink-0 border-b border-border bg-accent/30">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Total Balance</p>
            <h3 className="text-2xl font-bold text-foreground">₹24,500 <span className="text-xs text-[#21C063] font-semibold ml-1">To Receive</span></h3>
          </div>
          <PieChart className="w-8 h-8 text-primary opacity-20" />
        </div>
        <div className="flex gap-2">
          <div className="flex-1 bg-red-500/10 border border-red-500/20 rounded-lg p-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">You Gave</span>
            <span className="text-[12px] font-bold text-red-600 dark:text-red-400">₹8,200</span>
          </div>
          <div className="flex-1 bg-[#21C063]/10 border border-[#21C063]/20 rounded-lg p-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[#21C063] dark:text-[#21C063]">You Got</span>
            <span className="text-[12px] font-bold text-[#21C063] dark:text-[#21C063]">₹32,700</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col pb-16">
        <div className="px-4 py-2 bg-muted/50 flex items-center justify-between border-b border-border/50">
          <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Recent Transactions</span>
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-0 flex flex-col">
          <KhataItem name="Rahul Parts Store" date="Today, 10:40 AM" gave="2,500" got="" />
          <KhataItem name="Amit Customer" date="Yesterday, 04:15 PM" gave="" got="1,200" />
          <KhataItem name="Neha Screen Repair" date="14 Aug, 02:30 PM" gave="" got="3,500" />
          <KhataItem name="Ravi Distributors" date="12 Aug, 11:00 AM" gave="5,000" got="" />
          <KhataItem name="Vikram Walk-in" date="10 Aug, 09:15 AM" gave="" got="800" />
        </div>
      </div>

      <div className="p-3 border-t border-border flex gap-3 shrink-0 bg-card/90 backdrop-blur-md absolute bottom-0 left-0 right-0 z-40">
        <div className="flex-1 bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 rounded-xl py-2.5 flex items-center justify-center gap-2 font-bold text-[13px] border border-red-200 dark:border-red-900/50 shadow-sm cursor-pointer hover:bg-red-100 transition-colors">
          <ArrowLeft className="w-4 h-4 rotate-45" /> You Gave
        </div>
        <div className="flex-1 bg-green-50 text-[#21C063] dark:bg-green-950/30 dark:text-green-400 rounded-xl py-2.5 flex items-center justify-center gap-2 font-bold text-[13px] border border-green-200 dark:border-green-900/50 shadow-sm cursor-pointer hover:bg-green-100 transition-colors">
          <ArrowLeft className="w-4 h-4 -rotate-[135deg]" /> You Got
        </div>
      </div>
    </div>
  );
}

function KhataItem({ name, date, gave, got }: any) {
  return (
    <div className="py-3 border-b border-border/50 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-muted-foreground" />
        </div>
        <div>
          <h4 className="text-[13px] font-bold text-foreground">{name}</h4>
          <span className="text-[10px] text-muted-foreground">{date}</span>
        </div>
      </div>
      <div className="text-right">
        {gave && <div className="text-[13px] font-bold text-red-500 flex items-center justify-end gap-0.5"><span className="text-[10px]">₹</span>{gave}</div>}
        {got && <div className="text-[13px] font-bold text-[#21C063] flex items-center justify-end gap-0.5"><span className="text-[10px]">₹</span>{got}</div>}
      </div>
    </div>
  );
}
