import { useEffect, useState } from 'react';
import type {
  YouTubePlaylistItem,
  YouTubePlaylistSummary,
  YouTubeSearchResult,
  YouTubeVideoSummary,
} from '../../electron/youtube/api';

type Tab = 'library' | 'playlists' | 'search';

type Row = {
  videoId: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  durationMs?: number;
};

export function YouTubeBrowse({
  onPlay,
}: {
  onPlay?: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('library');
  const [library, setLibrary] = useState<YouTubeVideoSummary[] | null>(null);
  const [playlists, setPlaylists] = useState<YouTubePlaylistSummary[] | null>(null);
  const [openPlaylist, setOpenPlaylist] = useState<{
    id: string;
    title: string;
    items: YouTubePlaylistItem[] | null;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    void window.neonStereo.auth
      .getGoogleStatus()
      .then((s) => {
        if (mounted) setSignedIn(s.kind === 'logged-in');
      })
      .catch(() => {
        if (mounted) setSignedIn(false);
      });
    const off = window.neonStereo.auth.onAuthChange((e) => {
      if (e.kind === 'logged-in') setSignedIn(true);
      // Ignore logged-out here — Spotify/demo also emit this and would clobber our state.
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);

  async function handleSignIn(): Promise<void> {
    setErr(null);
    setSigningIn(true);
    try {
      await window.neonStereo.auth.googleLogin();
      setSignedIn(true);
      // Force the active tab to re-fetch.
      setLibrary(null);
      setPlaylists(null);
      setSearchResults(null);
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code !== 'AUTH_CANCELLED') setErr(errorMessage(e));
    } finally {
      setSigningIn(false);
    }
  }

  useEffect(() => {
    if (signedIn !== true) return;
    if (tab === 'library' && library === null) {
      setBusy(true);
      window.neonStereo.youtube
        .library()
        .then((items) => setLibrary(items))
        .catch((e: unknown) => {
          const code = (e as { code?: string } | null)?.code;
          if (code === 'YT_AUTH_EXPIRED') setSignedIn(false);
          else setErr(errorMessage(e));
        })
        .finally(() => setBusy(false));
    }
    if (tab === 'playlists' && playlists === null) {
      setBusy(true);
      window.neonStereo.youtube
        .playlists()
        .then((items) => setPlaylists(items))
        .catch((e: unknown) => {
          const code = (e as { code?: string } | null)?.code;
          if (code === 'YT_AUTH_EXPIRED') setSignedIn(false);
          else setErr(errorMessage(e));
        })
        .finally(() => setBusy(false));
    }
  }, [tab, library, playlists, signedIn]);

  async function play(row: Row): Promise<void> {
    setErr(null);
    try {
      await window.neonStereo.youtube.playVideo({
        videoId: row.videoId,
        title: row.title,
        durationMs: row.durationMs,
      });
      onPlay?.();
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'YT_AUTH_EXPIRED') setSignedIn(false);
      else setErr(errorMessage(e));
    }
  }

  async function runSearch(): Promise<void> {
    const q = query.trim();
    if (!q) return;
    setErr(null);
    setBusy(true);
    try {
      const items = await window.neonStereo.youtube.search(q);
      setSearchResults(items);
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'YT_AUTH_EXPIRED') setSignedIn(false);
      else setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function openPlaylistDetail(p: YouTubePlaylistSummary): Promise<void> {
    setOpenPlaylist({ id: p.id, title: p.title, items: null });
    setErr(null);
    setBusy(true);
    try {
      const items = await window.neonStereo.youtube.playlistItems(p.id);
      setOpenPlaylist({ id: p.id, title: p.title, items });
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'YT_AUTH_EXPIRED') {
        setSignedIn(false);
        setOpenPlaylist(null);
      } else {
        setErr(errorMessage(e));
        setOpenPlaylist({ id: p.id, title: p.title, items: [] });
      }
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === false) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          gap: 16,
          textAlign: 'center',
        }}
      >
        <div
          className="glow-text"
          style={{ fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase' }}
        >
          sign in to browse YouTube
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, maxWidth: 320, lineHeight: 1.5 }}>
          neon-stereo opens Google's sign-in page in your browser to read your
          library, playlists, and search. We never see your password.
        </div>
        <button
          className="no-drag"
          onClick={() => void handleSignIn()}
          disabled={signingIn}
          style={{
            border: '1px solid #ff5252',
            color: '#ff7c7c',
            textShadow: '0 0 4px #ff5252',
            boxShadow: '0 0 4px #ff5252, 0 0 12px rgba(255, 82, 82, 0.4)',
            padding: '12px 28px',
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            background: 'rgba(255, 82, 82, 0.08)',
            minWidth: 240,
          }}
        >
          {signingIn ? 'opening browser…' : '▶  sign in with google'}
        </button>
        {err && (
          <div style={{ color: '#ff5566', fontSize: 11, maxWidth: 320 }}>{err}</div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '0 24px 8px',
      }}
    >
      <div
        className="no-drag"
        style={{ display: 'flex', gap: 8, marginBottom: 10, flexShrink: 0 }}
      >
        <TabButton active={tab === 'library'} onClick={() => setTab('library')}>
          library
        </TabButton>
        <TabButton
          active={tab === 'playlists'}
          onClick={() => {
            setTab('playlists');
            setOpenPlaylist(null);
          }}
        >
          playlists
        </TabButton>
        <TabButton active={tab === 'search'} onClick={() => setTab('search')}>
          search
        </TabButton>
      </div>

      {tab === 'search' && (
        <form
          className="no-drag"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
          style={{ display: 'flex', gap: 8, marginBottom: 10, flexShrink: 0 }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search youtube…"
            style={{
              flex: 1,
              background: 'rgba(255, 82, 82, 0.04)',
              border: '1px solid #ff5252',
              color: 'var(--text)',
              padding: '8px 10px',
              fontSize: 12,
              letterSpacing: '0.08em',
            }}
          />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            style={{
              border: '1px solid #ff5252',
              color: '#ff7c7c',
              padding: '8px 14px',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              background: 'rgba(255, 82, 82, 0.08)',
            }}
          >
            go
          </button>
        </form>
      )}

      {err && (
        <div style={{ color: '#ff5566', fontSize: 11, marginBottom: 8, flexShrink: 0 }}>{err}</div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'library' && (
          <RowList
            rows={(library ?? []).map((v) => ({
              videoId: v.id,
              title: v.title,
              subtitle: v.channelTitle,
              thumbnailUrl: v.thumbnailUrl,
              durationMs: v.durationMs ?? undefined,
            }))}
            empty={
              busy
                ? 'loading library…'
                : library === null
                  ? ''
                  : 'no liked videos yet — like a few on YouTube to populate.'
            }
            onPlay={(r) => void play(r)}
          />
        )}
        {tab === 'playlists' && !openPlaylist && (
          <PlaylistList
            playlists={playlists ?? []}
            empty={
              busy
                ? 'loading playlists…'
                : playlists === null
                  ? ''
                  : 'no playlists yet.'
            }
            onOpen={(p) => void openPlaylistDetail(p)}
          />
        )}
        {tab === 'playlists' && openPlaylist && (
          <PlaylistDetail
            title={openPlaylist.title}
            rows={(openPlaylist.items ?? []).map((it) => ({
              videoId: it.videoId,
              title: it.title,
              subtitle: it.channelTitle,
              thumbnailUrl: it.thumbnailUrl,
            }))}
            loading={busy && openPlaylist.items === null}
            onBack={() => setOpenPlaylist(null)}
            onPlay={(r) => void play(r)}
          />
        )}
        {tab === 'search' && (
          <RowList
            rows={(searchResults ?? []).map((v) => ({
              videoId: v.videoId,
              title: v.title,
              subtitle: v.channelTitle,
              thumbnailUrl: v.thumbnailUrl,
            }))}
            empty={
              busy
                ? 'searching…'
                : searchResults === null
                  ? 'type a query and hit go.'
                  : 'no results.'
            }
            onPlay={(r) => void play(r)}
          />
        )}
      </div>
    </div>
  );
}

function RowList({
  rows,
  empty,
  onPlay,
}: {
  rows: Row[];
  empty: string;
  onPlay: (r: Row) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
        {empty}
      </div>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((r) => (
        <li key={r.videoId}>
          <button
            className="no-drag"
            onClick={() => onPlay(r)}
            style={rowBtnStyle}
            title={`Play ${r.title}`}
          >
            <Thumb url={r.thumbnailUrl} />
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={titleStyle}>{r.title}</div>
              <div style={subStyle}>{r.subtitle}</div>
            </div>
            <span style={{ color: '#ff7c7c', fontSize: 14 }}>▶</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlaylistList({
  playlists,
  empty,
  onOpen,
}: {
  playlists: YouTubePlaylistSummary[];
  empty: string;
  onOpen: (p: YouTubePlaylistSummary) => void;
}): JSX.Element {
  if (playlists.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12, textAlign: 'center' }}>
        {empty}
      </div>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {playlists.map((p) => (
        <li key={p.id}>
          <button
            className="no-drag"
            onClick={() => onOpen(p)}
            style={rowBtnStyle}
            title={`Open ${p.title}`}
          >
            <Thumb url={p.thumbnailUrl} />
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={titleStyle}>{p.title}</div>
              <div style={subStyle}>{p.itemCount} videos</div>
            </div>
            <span style={{ color: 'var(--text-dim)', fontSize: 14 }}>›</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlaylistDetail({
  title,
  rows,
  loading,
  onBack,
  onPlay,
}: {
  title: string;
  rows: Row[];
  loading: boolean;
  onBack: () => void;
  onPlay: (r: Row) => void;
}): JSX.Element {
  return (
    <div>
      <button
        className="no-drag"
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-dim)',
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          padding: '4px 0 8px',
          cursor: 'pointer',
        }}
      >
        ‹ playlists
      </button>
      <div
        className="glow-text"
        style={{
          fontSize: 14,
          letterSpacing: '0.08em',
          marginBottom: 8,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
      <RowList rows={rows} empty={loading ? 'loading…' : 'empty playlist.'} onPlay={onPlay} />
    </div>
  );
}

function Thumb({ url }: { url: string | null }): JSX.Element {
  return (
    <div
      style={{
        width: 48,
        height: 48,
        flexShrink: 0,
        background: 'var(--bg-elev)',
        border: '1px solid rgba(255, 82, 82, 0.4)',
        overflow: 'hidden',
        borderRadius: 3,
      }}
    >
      {url && (
        <img
          src={url}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${active ? '#ff5252' : 'rgba(255, 82, 82, 0.3)'}`,
        color: active ? '#ff7c7c' : 'var(--text-dim)',
        background: active ? 'rgba(255, 82, 82, 0.08)' : 'transparent',
        padding: '6px 14px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const rowBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '6px 8px',
  background: 'transparent',
  border: '1px solid transparent',
  color: 'var(--text)',
  cursor: 'pointer',
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const subStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-dim)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginTop: 2,
};

function errorMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (code === 'GOOGLE_NOT_CONFIGURED')
    return "YouTube sign-in isn't configured. Set GOOGLE_OAUTH_CLIENT_ID in .env and restart neon-stereo.";
  if (code === 'YT_NETWORK_ERROR') return "couldn't reach YouTube — check your connection.";
  if (code === 'YT_AUTH_EXPIRED') return 'session expired — sign in again.';
  if (code === 'YT_FORBIDDEN')
    return "YouTube refused this request. The Google account may not have access, or the YouTube Data API isn't enabled for this OAuth client.";
  if (code === 'YT_RATE_LIMITED') return 'rate limited — try again in a moment.';
  if (code === 'YT_NOT_ACTIVE') return 'youtube mode is not active.';
  return (e as { message?: string } | null)?.message ?? 'something went wrong';
}
