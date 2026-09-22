import { useState } from 'react';
import {
  Archive,
  BellOff,
  CheckCheck,
  ChevronRight,
  Edit3,
  Image as ImageIcon,
  MoreHorizontal,
  Phone,
  Pin,
  Search,
  SlidersHorizontal,
  Users,
  Volume2,
} from 'lucide-react';
import './refined-chat-inbox.css';

type Filter = 'All' | 'Unread' | 'Pinned';

const conversations = [
  { initials: 'RS', color: '#F1B750', name: 'Rakesh Sharma', time: '10:42 am', text: 'The display is working perfectly now.', count: 2, online: true, tint: '#FFF2D7' },
  { initials: 'NK', color: '#6696E8', name: 'Nisha Kumari', time: '9:18 am', text: 'Photo', media: true, unread: true, tint: '#E8F0FF' },
  { initials: 'VG', color: '#8D79CE', name: 'Vijay Gadgets', time: 'Yesterday', text: 'You: I have shared the estimate.', ticks: true, pinned: true, tint: '#EEE9FF' },
  { initials: 'AK', color: '#D88178', name: 'Anita K.', time: 'Yesterday', text: 'Voice message', voice: true, tint: '#FFE9E6' },
  { initials: 'MC', color: '#48A69A', name: 'Mobile Care', time: 'Mon', text: 'Your phone is ready for collection.', muted: true, tint: '#E3F8F3' },
];

export default function RefinedChatInbox() {
  const [filter, setFilter] = useState<Filter>('All');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const visible = conversations.filter((chat) => {
    const matchesFilter = filter === 'All' || (filter === 'Unread' ? chat.unread || chat.count : chat.pinned);
    return matchesFilter && chat.name.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <main className="avarpus-inbox">
      <header className="inbox-top">
        <div className="status-line"><span>9:41</span><span className="status-icons"><Volume2 size={12} fill="currentColor" /><span className="signal">▮▮▮</span><span>5G</span><span className="battery" /></span></div>
        <div className="inbox-toolbar">
          <div className="brand-lockup"><span className="brand-mark">A</span><span>Avarpus</span></div>
          <div className="header-actions">
            <button className="circle-action" aria-label="Search chats" onClick={() => setSearchOpen(!searchOpen)}><Search size={19} /></button>
            <button className="circle-action" aria-label="More chat options" onClick={() => setShowMenu(!showMenu)}><MoreHorizontal size={21} /></button>
          </div>
          {showMenu && <div className="mini-menu"><button onClick={() => setFilter('Pinned')}><Pin size={15} /> Pinned chats</button><button onClick={() => setFilter('Unread')}><Archive size={15} /> Archived</button></div>}
        </div>
        {searchOpen && <label className="search-box"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /><button onClick={() => { setQuery(''); setSearchOpen(false); }}>Close</button></label>}
        <div className="inbox-intro">
          <div><p className="eyebrow">YOUR CONVERSATIONS</p><h1>Chats</h1></div>
          <button className="new-chat" onClick={() => alert('New chat started')}><Edit3 size={17} /> New chat</button>
        </div>
      </header>

      <section className="chat-panel">
        <div className="sync-row"><span className="sync-dot" /> <span>Synced just now</span><button onClick={() => alert('Conversation list refreshed')}>Refresh</button></div>
        <div className="filters" aria-label="Conversation filters">
          {(['All', 'Unread', 'Pinned'] as Filter[]).map((option) => <button key={option} className={filter === option ? 'selected' : ''} onClick={() => setFilter(option)}>{option}{option === 'Unread' && <b>3</b>}</button>)}
          <button className="filter-tune" aria-label="More filters" onClick={() => alert('More filters opened')}><SlidersHorizontal size={17} /></button>
        </div>
        <div className="section-label"><span>{filter === 'All' ? 'RECENT' : filter.toUpperCase()}</span><span>{visible.length} conversations</span></div>
        <div className="conversation-list">
          {visible.length ? visible.map((chat) => (
            <button className={`conversation ${chat.unread || chat.count ? 'has-unread' : ''}`} key={chat.name} onClick={() => alert(`Opening chat with ${chat.name}`)}>
              <span className="avatar" style={{ background: chat.tint, color: chat.color }}>{chat.initials}<i className={chat.online ? 'is-online' : ''} /></span>
              <span className="conversation-copy">
                <span className="name-row"><strong>{chat.name}</strong><time>{chat.time}</time></span>
                <span className="message-row">
                  {chat.ticks && <CheckCheck size={16} className="ticks" />}
                  {chat.media && <ImageIcon size={15} />}
                  {chat.voice && <span className="voice-wave">︿∿︿</span>}
                  <span className="preview">{chat.text}</span>
                </span>
              </span>
              <span className="trailing">{chat.pinned && <Pin size={14} fill="currentColor" />}{chat.muted && <BellOff size={15} />}{chat.count && <b>{chat.count}</b>}<ChevronRight size={16} /></span>
            </button>
          )) : <div className="empty-state"><Users size={26} /><strong>No conversations here</strong><span>Try another view or begin a new chat.</span></div>}
        </div>
      </section>

      <button className="compose" onClick={() => alert('Choose a contact to start a chat')} aria-label="Start new chat"><Edit3 size={22} /></button>
      <nav className="bottom-nav">
        <button className="active"><span className="nav-icon"><Users size={20} /><i>3</i></span><span>Chats</span></button>
        <button onClick={() => alert('Status opened')}><span className="nav-icon"><span className="status-ring" /></span><span>Status</span></button>
        <button onClick={() => alert('Shop opened')}><span className="nav-icon"><span className="shop-icon">▰</span></span><span>Shop</span></button>
        <button onClick={() => alert('Calls opened')}><Phone size={20} /><span>Calls</span></button>
      </nav>
    </main>
  );
}