import React, { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Screen, Playlist, Asset, PlaylistItem } from '../types';
import { VitrionLogo } from './VitrionLogo';
import { 
  Tv, Sparkles, RefreshCw, Layers, Clock, ShieldCheck, 
  Expand, Maximize, CheckCircle2, AlertCircle, Play, Film, AlertTriangle, X,
  Zap, Power
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// @ts-ignore
import vitrionLogoOficial from '../assets/images/vitrion_logo_oficial.png';

// A base64 encoded silent 1-pixel video clip (MP4) to act as a browser-level wake lock (NoSleep.js equivalent)
const SILENT_VIDEO_BASE64 = "data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAzZtb292AAAAbG12aGQAAAAA0m6h0dJuodQAABgQAAAB9AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACNXRyYWsAAABcdGtoZAAAAAPSbqHR0m6h0QAAAAEAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAEAbWRpYQAAACBtZGhkAAAAA0m6h0dJuodQAAAOEAAAAcQAVcQAAAAAACFoZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAYxtZGluZgAAABxtbmhkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlZGluZgAAABxkZWZ0AAAAAAAAAA11cmwgAAAAAQAAAXBzdGJsAAAAp3N0c2QAAAAAAAAAAQAAAJZzdgZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAQABAAEsAAAAAEAAUAcGgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAf8AcGFzcAAAAAEAAAABAAAAFmNvbHJuY2xjAAAAAQAAAAEAAAABAAAAbmF2Y2MAAAAAYmF2Y2MBAQAL/0AALgEAAgA0AADgQAAA4QAAAOMAAKABAAAAAQAHZ2VvYgAAAAEAAAAAYXN0YwAAAAEAAAAAc3R0cwAAAAAAAAABAAAAAQAAAcQAAAAAc3RzeQAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzeiAAAAAAAAAcAAAAAQAAABRzdGNvAAAAAAAAAAEAAAAcAAAAYnVkZGEAAABadWR0YQAAAFJtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyAAAAAAAAAAAAAAAAAAAAAAAAYWlyZf8AAACVbW9vZgAAAChtZmhkAAAAAAAAdLIAAAAAbW9vZgAAAChtZmhkAAAAAAAAdLIAAAAAAAAAYnRyYWYAAAAIZGNobgAAAAAAKXRmYWQAAAAgYnRyYWYAAAAZZmxhZwAAAAAAdHJhbgAAAAAAdHJhZgAAAAAAbXVkYQAAAEptZGF0AAACV2gAAAAIZmxhZwAAAAAAdHJhbgAAAAAAdHJhZgAAAAAAbXVkYQAAAEptZGF0AAACV2gAAA==";

// Generates a random uppercase pairing code (4 characters)
function generatePairingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars like I, O, 0, 1
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helpers for high-durability persistence across smart TVs and browsers (e.g. Amazon Silk browser, Tizen, etc.)
function initDB(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject();
      return;
    }
    const request = indexedDB.open('VitrionTVStorage', 1);
    request.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    request.onsuccess = (e: any) => {
      resolve(e.target.result);
    };
    request.onerror = () => {
      reject();
    };
  });
}

function getIndexedDBValue(key: string): Promise<string | null> {
  return initDB().then(db => {
    return new Promise<string | null>((resolve) => {
      const transaction = db.transaction('settings', 'readonly');
      const store = transaction.objectStore('settings');
      const request = store.get(key);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        resolve(null);
      };
    });
  }).catch(() => null);
}

function setIndexedDBValue(key: string, value: string): Promise<void> {
  return initDB().then(db => {
    return new Promise<void>((resolve) => {
      const transaction = db.transaction('settings', 'readwrite');
      const store = transaction.objectStore('settings');
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }).catch(() => {});
}

function deleteIndexedDBValue(key: string): Promise<void> {
  return initDB().then(db => {
    return new Promise<void>((resolve) => {
      const transaction = db.transaction('settings', 'readwrite');
      const store = transaction.objectStore('settings');
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }).catch(() => {});
}

function getCookie(name: string): string | null {
  try {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
  } catch (e) {
    console.warn("Could not read cookie due to sandboxing:", e);
  }
  return null;
}

function setCookie(name: string, value: string, days: number = 365 * 10) {
  try {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1050)); // about 365 days
      expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
  } catch (e) {
    console.warn("Could not set cookie due to sandboxing:", e);
  }
}

function eraseCookie(name: string) {
  try {
    document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax';
  } catch (e) {
    console.warn("Could not erase cookie due to sandboxing:", e);
  }
}

function getStoredScreenId(): string | null {
  if (typeof window === 'undefined') return null;
  let id: string | null = null;
  try {
    id = localStorage.getItem('op_player_screen_id');
  } catch (e) {
    console.warn('Could not read localStorage due to sandboxing:', e);
  }
  if (!id) {
    id = getCookie('op_player_screen_id');
    if (id) {
      try {
        localStorage.setItem('op_player_screen_id', id);
      } catch (e) {}
    }
  } else {
    setCookie('op_player_screen_id', id);
  }
  return id;
}

function setStoredScreenId(id: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('op_player_screen_id', id);
  } catch (e) {}
  setCookie('op_player_screen_id', id);
  setIndexedDBValue('op_player_screen_id', id);
}

function removeStoredScreenId() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('op_player_screen_id');
  } catch (e) {}
  eraseCookie('op_player_screen_id');
  deleteIndexedDBValue('op_player_screen_id');
}

function getBrasiliaTimeParts(): { dayIndex: number; timeStr: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    let weekday = 'Sun';
    let hour = '12';
    let minute = '00';
    for (const part of parts) {
      if (part.type === 'weekday') weekday = part.value;
      else if (part.type === 'hour') hour = part.value;
      else if (part.type === 'minute') minute = part.value;
    }
    
    if (hour === '24') hour = '00';
    
    const daysKeysMap: Record<string, number> = {
      'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
    };
    
    const dayIndex = daysKeysMap[weekday] !== undefined ? daysKeysMap[weekday] : new Date().getDay();
    
    return {
      dayIndex,
      timeStr: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
    };
  } catch (e) {
    console.warn("Intl timezone formatting error:", e);
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    return {
      dayIndex: now.getDay(),
      timeStr: `${h}:${m}`
    };
  }
}

function isScheduledOff(doc: any, useDefaultFallback: boolean = false): boolean {
  if (!doc) return false;

  const { dayIndex, timeStr: currentTimeStr } = getBrasiliaTimeParts();

  // A schedule is considered valid/active if at least one day is enabled
  const hasActiveSchedule = doc.schedule && Object.values(doc.schedule).some((day: any) => day?.enabled === true);

  if (hasActiveSchedule) {
    const daysKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayKey = daysKeys[dayIndex];
    const dayConfig = doc.schedule[dayKey];
    if (dayConfig && dayConfig.enabled) {
      const { startTime, endTime } = dayConfig;
      if (startTime && endTime) {
        if (startTime <= endTime) {
          return currentTimeStr < startTime || currentTimeStr >= endTime;
        } else {
          return currentTimeStr >= endTime && currentTimeStr < startTime;
        }
      }
    }
    // If schedule is active but disabled for today, then the screen/playlist is OFF (shows black screen)
    return true;
  }

  // 2. Default weekly schedule (only if useDefaultFallback is true):
  if (!useDefaultFallback) {
    return false;
  }

  // • Segunda a sexta (1 to 5) → ativo 07h00 às 22h00
  // • Sábado (6) → ativo 08h00 às 20h00
  // • Domingo (0) → ativo 09h00 às 18h00
  let activeStart = "07:00";
  let activeEnd = "22:00";

  if (dayIndex >= 1 && dayIndex <= 5) { // Segunda a Sexta
    activeStart = "07:00";
    activeEnd = "22:00";
  } else if (dayIndex === 6) { // Sábado
    activeStart = "08:00";
    activeEnd = "20:00";
  } else if (dayIndex === 0) { // Domingo
    activeStart = "09:00";
    activeEnd = "18:00";
  }

  return currentTimeStr < activeStart || currentTimeStr >= activeEnd;
}

export default function TVPlayer() {
  const [screenId, setScreenId] = useState<string | null>(null);
  const [screenDoc, setScreenDoc] = useState<Screen | null>(null);
  const [activePlaylistDoc, setActivePlaylistDoc] = useState<any>(null);
  const [isOffBySchedule, setIsOffBySchedule] = useState(false);

  useEffect(() => {
    const checkSchedule = () => {
      const hasScreenSchedule = screenDoc?.schedule && Object.values(screenDoc.schedule).some((day: any) => day?.enabled === true);
      const isPlaylistMode = screenDoc?.contentType === 'playlist';
      const hasPlaylistSchedule = isPlaylistMode && activePlaylistDoc?.schedule && Object.values(activePlaylistDoc.schedule).some((day: any) => day?.enabled === true);

      let off = false;
      if (hasScreenSchedule) {
        // If the screen has a custom schedule configured, respect only it
        off = isScheduledOff(screenDoc, false);
      } else if (hasPlaylistSchedule) {
        // If the screen has no custom schedule, but the playlist does, respect only the playlist's schedule
        off = isScheduledOff(activePlaylistDoc, false);
      } else {
        // Fallback to the default weekly schedule today
        off = isScheduledOff(screenDoc, true);
      }

      setIsOffBySchedule(off);
    };

    checkSchedule();
    const interval = setInterval(checkSchedule, 30000); // Check every 30 seconds as requested
    return () => clearInterval(interval);
  }, [screenDoc, activePlaylistDoc]);
  const [activeAsset, setActiveAsset] = useState<any>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownTargetAssetId, setCountdownTargetAssetId] = useState<string | null>(null);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [realtimeClock, setRealtimeClock] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [initTrigger, setInitTrigger] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Manual synchronization inputs for existing screens
  const [manualCode, setManualCode] = useState('');
  const [isConnectingManual, setIsConnectingManual] = useState(false);
  const [manualError, setManualError] = useState('');

  // Screen Wake Lock API State
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [antiSleepSupported, setAntiSleepSupported] = useState(false);
  const wakeLockRef = useRef<any>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Screen Wake Lock API actions
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        if (wakeLockRef.current) return; // already acquired
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setWakeLockActive(true);
        console.log('Vitrion: Screen Wake Lock is successfully active!');
        
        wakeLockRef.current.addEventListener('release', () => {
          setWakeLockActive(false);
          wakeLockRef.current = null;
        });
      } catch (err: any) {
        setWakeLockActive(false);
        console.warn(`Vitrion: Screen Wake Lock request failed: ${err.message}`);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setWakeLockActive(false);
      } catch (err) {
        console.error('Vitrion: Screen Wake Lock release failed:', err);
      }
    }
  };

  // Check Wake Lock API support on load
  useEffect(() => {
    if ('wakeLock' in navigator) {
      setAntiSleepSupported(true);
    }
  }, []);

  // Screen Wake Lock React lifecycle manager with auto-recovery
  useEffect(() => {
    requestWakeLock();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        await requestWakeLock();
      }
    };

    const handleFsChangeForWakeLock = () => {
      requestWakeLock();
    };

    // Human interaction or remote control key stroke secures the wake lock state
    const handleKeepAliveInteraction = () => {
      requestWakeLock();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFsChangeForWakeLock);
    window.addEventListener('mousemove', handleKeepAliveInteraction);
    window.addEventListener('keydown', handleKeepAliveInteraction);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFsChangeForWakeLock);
      window.removeEventListener('mousemove', handleKeepAliveInteraction);
      window.removeEventListener('keydown', handleKeepAliveInteraction);
      releaseWakeLock();
    };
  }, []);

  // Watchdog timer ref and state
  const watchdogTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetWatchdog = () => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
    }
    // Set 5-minute watchdog timer
    watchdogTimerRef.current = setTimeout(() => {
      console.warn("Watchdog trigger: No activity or content update detected for 5 minutes. Reloading Vercel app to prevent frozen screen...");
      window.location.reload();
    }, 5 * 60 * 1000);
  };

  // Reset watchdog on key player updates (screen state, active asset, playlist transition)
  useEffect(() => {
    resetWatchdog();
    return () => {
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    };
  }, [screenDoc, activeAsset, playlistIndex, isOffBySchedule]);

  // Monitor network connection and reload automatically on recovery
  useEffect(() => {
    let wasOffline = !navigator.onLine;

    const handleOnline = () => {
      if (wasOffline) {
        console.log("Internet reconnected! Reloading page to resume player smoothly...");
        window.location.reload();
      }
    };

    const handleOffline = () => {
      wasOffline = true;
      console.warn("Internet disconnected!");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Real-time Clock for signage styling
  useEffect(() => {
    const tick = () => {
      try {
        const timeStr = new Date().toLocaleTimeString('pt-BR', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit'
        });
        setRealtimeClock(timeStr);
      } catch (e) {
        const now = new Date();
        setRealtimeClock(now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Initialize countdown when activeAsset is an image and is new
  useEffect(() => {
    if (activeAsset && activeAsset.type === 'image') {
      const assetKey = activeAsset.id || activeAsset.url || activeAsset.assetId;
      if (countdownTargetAssetId !== assetKey) {
        setCountdownTargetAssetId(assetKey);
        setCountdown(10);
      }
    } else {
      setCountdown(null);
      setCountdownTargetAssetId(null);
    }
  }, [activeAsset, countdownTargetAssetId]);

  // Countdown clock decrement logic
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Synchronize video tag play/pause based on active schedule state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isOffBySchedule) {
      console.log("Weekly Schedule OFF: Pausing loop video immediately.");
      video.pause();
    } else {
      console.log("Weekly Schedule ON: Starting loop video playback.");
      video.play().catch((err) => console.warn("Watchdog error playing video on schedule active:", err));
    }
  }, [isOffBySchedule, activeAsset]);

  // Video playback watchdog (runs every 4 seconds to catch crashes/pauses in under 5 seconds)
  useEffect(() => {
    let lastTime = -1;
    let stuckCount = 0;

    const checkVideoPlayback = () => {
      const video = videoRef.current;
      if (!video || isOffBySchedule) return;

      // Ensure loop and playsInline are always active
      if (!video.loop) video.loop = true;

      // If paused or ended unexpectedly during active hours, restart from beginning
      if (video.paused || video.ended) {
        console.warn("Watchdog: Video was paused or ended unexpectedly. Restarting from beginning...");
        video.currentTime = 0;
        video.play().catch((err) => console.warn("Watchdog recovery play failed:", err));
        return;
      }

      // Check for stuck/frozen playback (currentTime not changing)
      const currentTime = video.currentTime;
      if (currentTime === lastTime) {
        stuckCount++;
        if (stuckCount >= 1) { // Stuck for 4 seconds
          console.warn("Watchdog: Video frame is frozen/stuck. Resetting video player...");
          video.currentTime = 0;
          video.play().catch((err) => console.warn("Watchdog recovery play failed:", err));
          stuckCount = 0;
        }
      } else {
        stuckCount = 0;
      }
      lastTime = currentTime;
    };

    const intervalId = setInterval(checkVideoPlayback, 4000);
    return () => clearInterval(intervalId);
  }, [isOffBySchedule, activeAsset]);

  // Initialization: check localstorage and cookies for paired credentials, or create a brand new unauthenticated screen code
  useEffect(() => {
    const initScreen = async () => {
      setErrorMessage('');
      
      const urlParams = new URLSearchParams(window.location.search);
      const urlScreenId = urlParams.get('screenId') || urlParams.get('id');
      
      let code = urlScreenId;
      if (!code) {
        const idbCode = await getIndexedDBValue('op_player_screen_id');
        if (idbCode) {
          code = idbCode;
          let needsSave = false;
          try {
            needsSave = !localStorage.getItem('op_player_screen_id') || !getCookie('op_player_screen_id');
          } catch (e) {
            needsSave = !getCookie('op_player_screen_id');
          }
          if (needsSave) {
            try {
              localStorage.setItem('op_player_screen_id', idbCode);
            } catch (e) {}
            setCookie('op_player_screen_id', idbCode);
          }
        } else {
          code = getStoredScreenId();
        }
      }

      const registerNewScreen = async (newCode: string, attempt = 1): Promise<boolean> => {
        try {
          const ref = doc(db, 'screens', newCode);
          await setDoc(ref, {
            id: newCode,
            name: 'Smart TV Player',
            pairingCode: newCode,
            status: 'online',
            lastActive: serverTimestamp(),
            contentType: 'idle',
            contentId: '',
            pairedAt: null,
            ownerId: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            deviceTime: Date.now(),
          });
          setStoredScreenId(newCode);
          setScreenId(newCode);
          return true;
        } catch (err: any) {
          console.error(`Erro ao registrar monitor (tentativa ${attempt}):`, err);
          if (err?.code === 'permission-denied') {
            setErrorMessage("Permissão negada pelo Firebase (Permission Denied). Verifique se as regras de segurança permitem registro anônimo.");
            return false;
          }
          if (attempt < 3) {
            const retryCode = generatePairingCode();
            // Wait 1.2s before retrying registration
            await new Promise(r => setTimeout(r, 1200));
            return registerNewScreen(retryCode, attempt + 1);
          }
          setErrorMessage(`Falha na conexão ao registrar o monitor. Detalhes: ${err?.message || err}`);
          return false;
        }
      };

      let initAttempt = 1;
      const runInit = async (): Promise<boolean> => {
        try {
          if (code) {
            const ref = doc(db, 'screens', code);
            const snap = await getDoc(ref);
            if (snap.exists()) {
              if (urlScreenId) {
                setStoredScreenId(urlScreenId);
              }
              setScreenId(code);
              return true;
            } else {
              console.warn(`Código ${code} não encontrado no Firestore. Re-registrando...`);
              return await registerNewScreen(code);
            }
          } else {
            const freshCode = generatePairingCode();
            return await registerNewScreen(freshCode);
          }
        } catch (err: any) {
          console.error(`Erro na inicialização do player (tentativa ${initAttempt}):`, err);
          if (err?.code === 'permission-denied') {
            setErrorMessage("Erro de permissão (Permission Denied) ao acessar Firestore. Verifique se as regras de segurança permitem sua leitura.");
            return false;
          }
          if (initAttempt < 3) {
            initAttempt++;
            // Wait 1.5 seconds before retrying
            await new Promise(r => setTimeout(r, 1500));
            return runInit();
          }
          setErrorMessage(`Erro de conexão com o banco de dados. Detalhes: ${err?.message || err}`);
          return false;
        }
      };

      await runInit();
    };

    initScreen();
  }, [initTrigger]);

  // Connect to an existing pre-configured platform screen by its unique code/ID
  const handleConnectManualCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualError('');
    const code = manualCode.trim().toUpperCase();
    if (!code) {
      setManualError('Por favor, informe seu código.');
      return;
    }

    if (code.length < 4) {
      setManualError('O código do display deve conter pelo menos 4 caracteres.');
      return;
    }

    setIsConnectingManual(true);
    try {
      const ref = doc(db, 'screens', code);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setStoredScreenId(code);
        setScreenId(code);
        setInitTrigger(prev => prev + 1);
        setManualCode('');
      } else {
        setManualError('Código não cadastrado ou inválido. Cadastre este monitor no seu Painel.');
      }
    } catch (err: any) {
      console.error(err);
      setManualError('Falha ao conectar: erro de rede ou permissão recusada.');
    } finally {
      setIsConnectingManual(false);
    }
  };

  // Heartbeat Loop (pulse online status to firestore every 30 seconds to optimize write quota usage)
  useEffect(() => {
    if (!screenId) return;

    // Send initial immediate heartbeat
    const sendPulse = async () => {
      try {
        await updateDoc(doc(db, 'screens', screenId), {
          status: 'online',
          lastActive: serverTimestamp(),
          updatedAt: serverTimestamp(),
          deviceTime: Date.now()
        });
      } catch (err) {
        console.warn("Heartbeat error, screen may have been deleted or unlinked on control panel:", err);
      }
    };
    sendPulse();

    const intervalId = setInterval(sendPulse, 30000);
    return () => clearInterval(intervalId);
  }, [screenId]);

  // Synchronize Screen state from Firestore in real-time
  useEffect(() => {
    if (!screenId) return;

    const ref = doc(db, 'screens', screenId);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          console.warn("Screen document was deleted. Resetting and self-healing...");
          removeStoredScreenId();
          setScreenId(null);
          setScreenDoc(null);
          setActiveAsset(null);
          // Trigger regeneration
          setInitTrigger(prev => prev + 1);
          return;
        }

        const data = snapshot.data();
        const sc: Screen = {
          id: snapshot.id,
          name: data.name || 'Smart TV',
          pairingCode: data.pairingCode || '',
          status: data.status || 'online',
          lastActive: data.lastActive,
          contentType: data.contentType || 'idle',
          contentId: data.contentId || '',
          pairedAt: data.pairedAt,
          ownerId: data.ownerId || '',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          schedule: data.schedule,
        };
        setScreenDoc(sc);
      },
      (err) => {
        console.error("Erro no onSnapshot do player:", err);
        setErrorMessage("Falha de conexão em tempo real com o servidor de TV.");
      }
    );

    return () => unsubscribe();
  }, [screenId]);

  // Synchronize Content based on Screen doc settings
  useEffect(() => {
    if (!screenDoc || screenDoc.ownerId === '') {
      setActiveAsset(null);
      setPlaylistItems([]);
      setActivePlaylistDoc(null);
      return;
    }

    const { contentType, contentId } = screenDoc;

    if (contentType === 'idle' || contentType === 'standby' || contentType === 'stopped') {
      setActiveAsset(null);
      setPlaylistItems([]);
      setActivePlaylistDoc(null);
      return;
    }

    if (contentType === 'asset') {
      setActivePlaylistDoc(null);
      setPlaylistItems([]);
      if (!contentId) {
        setActiveAsset(null);
        return;
      }
      // Pull single asset document real-time
      const assetRef = doc(db, 'assets', contentId);
      const unsubAsset = onSnapshot(assetRef, (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setActiveAsset({
            id: snap.id,
            ...d
          });
        }
      });
      return () => unsubAsset();
    }

    if (contentType === 'playlist') {
      if (!contentId) {
        setActivePlaylistDoc(null);
        setPlaylistItems([]);
        setActiveAsset(null);
        return;
      }
      // Pull playlist document real-time
      const playlistRef = doc(db, 'playlists', contentId);
      const unsubPlaylist = onSnapshot(playlistRef, (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setActivePlaylistDoc({
            id: snap.id,
            ...d
          });
          const newItems = d.items || [];
          setPlaylistItems((prev) => {
            const isSame = prev.length === newItems.length &&
              prev.every((item, idx) => item.assetId === newItems[idx].assetId && item.duration === newItems[idx].duration);
            if (isSame) return prev;
            setPlaylistIndex(0);
            return newItems;
          });
        }
      });
      return () => unsubPlaylist();
    }

  }, [screenDoc?.id, screenDoc?.ownerId, screenDoc?.contentType, screenDoc?.contentId]);

  // Loop timer for Playlist sequences
  useEffect(() => {
    if (playlistItems.length === 0) return;
    if (isOffBySchedule) return;

    const activeItem = playlistItems[playlistIndex];
    if (!activeItem) {
      setPlaylistIndex(0);
      return;
    }
    setActiveAsset(activeItem);

    const nextIndex = (playlistIndex + 1) % playlistItems.length;
    const isImage = activeItem.type === 'image';
    const itemDurationMs = ((activeItem.duration || 10) + (isImage ? 10 : 0)) * 1000;

    const timeoutId = setTimeout(() => {
      setPlaylistIndex(nextIndex);
    }, itemDurationMs);

    return () => clearTimeout(timeoutId);
  }, [playlistItems, playlistIndex, isOffBySchedule]);

  // Toggle Fullscreen view helper
  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error("Failed to go fullscreen", err);
      });
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Keyboard and Remote Control listeners (optimized for Amazon Fire TV / Smart TV D-Pad Select)
  useEffect(() => {
    const handleControlKeys = (e: KeyboardEvent) => {
      // Keycode 13 is Enter (D-pad select on physical Fire TV controls). Space (32) is also supported as a trigger.
      if (e.key === 'Enter' || e.keyCode === 13 || e.key === ' ' || e.keyCode === 32) {
        console.log("Ação do controle remoto Fire TV / Smart TV detectada. Alternando tela cheia...");
        handleToggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleControlKeys);
    return () => window.removeEventListener('keydown', handleControlKeys);
  }, [screenId]);

  // Auto-fullscreen on load and on any first user interaction (touch, key, click)
  useEffect(() => {
    let attempted = false;

    const autoEnter = () => {
      if (attempted) return;
      if (!document.fullscreenElement && containerRef.current) {
        containerRef.current.requestFullscreen()
          .then(() => {
            setIsFullscreen(true);
            attempted = true;
            cleanup();
          })
          .catch((err) => {
            console.log("Auto fullscreen request blocked or postponed till next interaction:", err);
          });
      } else if (document.fullscreenElement) {
        attempted = true;
        cleanup();
      }
    };

    const cleanup = () => {
      window.removeEventListener('click', autoEnter);
      window.removeEventListener('keydown', autoEnter);
      window.removeEventListener('touchstart', autoEnter);
      window.removeEventListener('mousedown', autoEnter);
    };

    // Listen to all interaction events
    window.addEventListener('click', autoEnter);
    window.addEventListener('keydown', autoEnter);
    window.addEventListener('touchstart', autoEnter);
    window.addEventListener('mousedown', autoEnter);

    // Attempt immediately (some modern smart setups allow it under specific criteria/contexts)
    const timeoutId = setTimeout(autoEnter, 1200);

    return () => {
      cleanup();
      clearTimeout(timeoutId);
    };
  }, [screenId]);

  // 1. Loading screen
  if (!screenId || !screenDoc) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6">
        {errorMessage ? (
          <div className="max-w-md text-center space-y-4">
            <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto animate-pulse" />
            <h2 className="text-lg font-bold">Falha na Inicialização</h2>
            <p className="text-xs text-slate-400 font-mono leading-relaxed bg-rose-500/10 p-3 rounded border border-rose-500/20">
              {errorMessage}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setInitTrigger(prev => prev + 1)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Tentar Novamente
              </button>
              <button
                onClick={() => {
                  removeStoredScreenId();
                  setInitTrigger(prev => prev + 1);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold transition"
              >
                Gerar Novo Código
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin mx-auto" />
            <p className="text-xs tracking-widest uppercase text-slate-500 font-semibold font-mono">Iniciando reprodutor...</p>
          </div>
        )}
      </div>
    );
  }

  // 2. Unpaired pairing instruction screen
  const isUnpaired = screenDoc.ownerId === '';
  if (isUnpaired) {
    // Generate QR code pointing to current URL with ?mode=player
    const playerUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}${window.location.pathname}?mode=player`
      : 'https://ais-pre-pkknysdq33bgf5qtn3spiw-197918397442.us-west2.run.app?mode=player';
    
    // Free high-quality QR Code API from qrserver
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(playerUrl)}&color=6366f1&bgcolor=ffffff`;

    return (
      <div ref={containerRef} className="min-h-screen w-full bg-slate-950 flex flex-col justify-between p-6 sm:p-8 text-white relative overflow-hidden font-sans select-none">
        <video
          src={SILENT_VIDEO_BASE64}
          loop
          muted
          playsInline
          autoPlay
          className="hidden pointer-events-none w-1 h-1 absolute opacity-0"
          style={{ width: '1px', height: '1px' }}
        />
        
        {/* Ambient brand logo background */}
        <div className="absolute inset-0 z-0 flex items-center justify-center p-12">
          <img 
            src={vitrionLogoOficial} 
            alt="" 
            className="max-h-[60vh] max-w-full object-contain opacity-10"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs" />
        </div>

        <header className="flex items-center justify-between border-b border-white/5 pb-4 shrink-0 z-10">
          <div className="flex items-center gap-2">
            <VitrionLogo variant="badge" theme="dark" size="xs" />
            <div className="h-4 w-px bg-slate-800 mx-1 hidden sm:block"></div>
            <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold hidden sm:inline">Smart TV Signage Node</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 px-2 py-0.5 rounded font-bold font-mono uppercase tracking-wider">
              SINAL ATIVO ✔
            </span>
            <span 
              className={`text-[10px] px-2 py-0.5 rounded font-bold font-mono uppercase tracking-wider flex items-center gap-1 transition ${
                wakeLockActive 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/15' 
                  : 'bg-slate-800 text-slate-400 border border-white/5'
              }`}
              title="Evita que o monitor ou TV desligue a tela automaticamente"
            >
              <Zap className={`w-3 h-3 ${wakeLockActive ? 'text-cyan-400 animate-pulse' : 'text-slate-500'}`} />
              <span>Anti-Sleep {wakeLockActive ? 'Ativo' : 'Inativo'}</span>
            </span>
            <button
              onClick={handleToggleFullscreen}
              className="p-1 px-2.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Maximize className="w-3.5 h-3.5" />
              Fullscreen
            </button>
          </div>
        </header>

        {/* Dual Column: Quick Pairing + Amazon Fire TV setup */}
        <main className="flex-1 flex flex-col justify-center my-6 z-10 max-w-5xl mx-auto w-full space-y-8 animate-fade-in">
          <div className="text-center space-y-2">
            <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest bg-indigo-500/20 px-3.5 py-1 rounded-full border border-indigo-400/20 inline-block">
              CONEXÃO INTELIGENTE DE TVS
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-white">Vincular Monitor para Transmissão</h1>
            <p className="text-xs text-slate-400 max-w-xl mx-auto">
              Transforme esta tela em um letreiro digital corporativo dinâmico. Configure seu computador ou dispositivo Amazon Fire TV / Smart TV em segundos.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left Column: Code and Standard sync steps */}
            <div className="lg:col-span-7 flex flex-col justify-between bg-slate-900/60 backdrop-blur-md rounded-2xl border border-white/10 p-6 shadow-2xl relative">
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest bg-indigo-950/40 border border-indigo-500/25 px-2.5 py-0.5 rounded">
                    Código de Identificação
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">ID Único para Transmissão</span>
                </div>
                
                <div className="text-center bg-black/40 rounded-xl py-6 border border-white/5">
                  <div className="text-6xl sm:text-7xl font-mono font-bold tracking-widest text-indigo-300 py-2 select-all">
                    {screenId}
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono">Use este código de pareamento no seu Painel Gerenciador</p>
                </div>

                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">Como parear no Painel de Controle:</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-white/2 p-3 rounded-lg border border-white/5">
                      <span className="text-[8px] font-mono text-indigo-400 uppercase tracking-widest block font-bold">1/ ACESSAR</span>
                      <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">Abra o seu <strong>Painel Gerenciador</strong> no celular ou computador.</p>
                    </div>
                    <div className="bg-white/2 p-3 rounded-lg border border-white/5">
                      <span className="text-[8px] font-mono text-indigo-400 uppercase tracking-widest block font-bold">2/ VINCULAR</span>
                      <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">Vá na guia <strong>Telas</strong> e clique em "Parear Nova Tela".</p>
                    </div>
                    <div className="bg-white/2 p-3 rounded-lg border border-white/5">
                      <span className="text-[8px] font-mono text-indigo-400 uppercase tracking-widest block font-bold text-indigo-400">3/ TRANSMITIR</span>
                      <p className="text-[10px] text-slate-350 mt-1.5 leading-snug font-semibold text-white">INSIRA o código acima para autorizar o sinal!</p>
                    </div>
                  </div>
                </div>

                {/* Sintonizar via Código Manual (Direct pairing by entering existing code) */}
                <div className="border-t border-white/10 pt-4 mt-2">
                  <form onSubmit={handleConnectManualCode} className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Ou digite seu Código Existente de TV:
                      </label>
                      <span className="text-[9px] text-indigo-400 font-mono font-semibold">Sintonizar Código da Plataforma</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Ex: ABCD"
                        value={manualCode}
                        onChange={(e) => setManualCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                        className="flex-1 min-w-0 bg-black/60 border border-slate-700 text-white text-xs px-3.5 py-2.5 rounded-lg focus:outline-hidden focus:border-indigo-500 uppercase tracking-widest font-mono font-bold"
                      />
                      <button
                        type="submit"
                        disabled={isConnectingManual}
                        className="bg-indigo-600 hover:bg-indigo-505 disabled:bg-indigo-800/50 text-white text-xs font-bold px-4 py-2.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer shrink-0"
                      >
                        {isConnectingManual ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        <span>Sintonizar & Gravar</span>
                      </button>
                    </div>
                    {manualError && (
                      <p className="text-[11px] text-rose-400 font-medium flex items-center gap-1 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        {manualError}
                      </p>
                    )}
                  </form>
                </div>
              </div>
            </div>

            {/* Right Column: Amazon Fire TV Special Controller Guidance */}
            <div className="lg:col-span-5 flex flex-col justify-between bg-gradient-to-br from-amber-500/10 to-indigo-950/25 backdrop-blur-md rounded-2xl border border-amber-500/20 p-6 shadow-2xl relative space-y-4">
              <div className="absolute -top-3 right-6 bg-amber-600 border border-amber-400 px-3.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest text-white shadow-lg">
                🔥 Configuração Fire TV
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest bg-amber-500/10 border border-amber-500/35 px-2 py-0.5 rounded">
                    Amazon Fire TV
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono">Instruções de Controle Remoto</span>
                </div>

                <div className="flex items-start gap-4 pt-1">
                  {/* Left part of column: step text */}
                  <div className="flex-1 space-y-2.5 text-xs text-slate-300 leading-relaxed">
                    <p className="text-[10.5px] text-slate-400 leading-normal">
                      Para conectar e sintonizar seu **Amazon Fire TV Stick / Cube / Smart OS**:
                    </p>
                    <ol className="list-decimal pl-4.5 space-y-2 text-[10.5px] text-slate-400 leading-snug">
                      <li>Pesquise por **Amazon Silk Web Browser** na Appstore do seu Fire TV e abra o navegador.</li>
                      <li>Aponte a TV para esta URL de reprodução ou **escanear o QR Code** ao lado com a câmera do celular.</li>
                      <li>Use o sufixo <strong><code className="text-amber-300 bg-amber-500/15 px-1 py-0.5 rounded font-mono font-bold">?mode=player</code></strong> no fim do link para iniciar o TV Player diretamente.</li>
                      <li><strong>Controle Remoto Fire TV:</strong> Aperte o botão central circular **[OK / SELECT]** para ativar a Tela Cheia (Fullscreen) e ocultar barras de navegação do navegador Silk!</li>
                    </ol>
                  </div>

                  {/* Right part of column: QR Code generated dynamically */}
                  <div className="shrink-0 flex flex-col items-center gap-1 bg-white p-2 rounded-xl border border-amber-500/20 shadow-lg select-none">
                    <img 
                      src={qrCodeUrl} 
                      alt="Player QR Code" 
                      className="w-24 h-24 object-contain"
                    />
                    <span className="text-[7.5px] font-bold text-slate-800 uppercase tracking-wider text-center">Escanear com Celular</span>
                  </div>
                </div>
              </div>

              <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5 flex items-start gap-2 text-[10px] text-amber-300/90 leading-snug">
                <span className="text-xs text-amber-400 mt-0.5">💡</span>
                <span>
                  <strong>Tip de Navegação:</strong> O player detecta cliques vindos do controle de TV. Pressionar a engrenagem ou botão de rolagem da TV também alterna o modo de tela cheia.
                </span>
              </div>
            </div>
          </div>
        </main>

        <footer className="border-t border-white/5 pt-4 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 shrink-0 z-10">
          <p>Plataforma para gerenciamento de mídia dinâmica no varejo e escritórios.</p>
          <div className="flex items-center gap-1 font-mono mt-2 sm:mt-0 font-bold">
            <Clock className="w-3.5 h-3.5 mt-0.5" />
            <span>{realtimeClock} • BRASÍLIA</span>
          </div>
        </footer>
      </div>
    );
  }

  // 3. Paired active player renderer
  return (
    <div 
      ref={containerRef} 
      className="min-h-screen w-full bg-black flex flex-col justify-between text-white relative overflow-hidden font-sans select-none"
    >
      <video
        src={SILENT_VIDEO_BASE64}
        loop
        muted
        playsInline
        autoPlay
        className="hidden pointer-events-none w-1 h-1 absolute opacity-0"
        style={{ width: '1px', height: '1px' }}
      />
      {isOffBySchedule && (
        <div 
          className="absolute inset-0 bg-black z-50 animate-fade-in" 
          id="tv-player-schedule-black-screen"
        />
      )}
      {/* Absolute fullscreen media host */}
      <AnimatePresence mode="wait">
        {screenDoc.contentType === 'standby' ? (
          <motion.div 
            key="standby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black flex flex-col items-center justify-center"
          />
        ) : screenDoc.contentType === 'stopped' ? (
          <motion.div 
            key="stopped"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black flex flex-col items-center justify-center p-6 text-center select-none"
          >
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 rounded-full border border-rose-500/20 bg-rose-950/20 flex items-center justify-center text-rose-500 animate-pulse">
                <Power className="w-4 h-4" />
              </div>
              <span className="text-[9px] text-rose-500/60 uppercase font-black tracking-widest font-mono">
                Monitor Desligado
              </span>
              <span className="text-[8px] text-slate-755 font-mono mt-0.5 text-slate-600">
                Pressione POWER no controle remoto para iniciar
              </span>
            </div>
          </motion.div>
        ) : !activeAsset ? (
          <motion.div 
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[#020B18] flex flex-col items-center justify-center p-8 text-center"
          >
            <div className="space-y-5 flex flex-col items-center">
              <div className="relative w-16 h-16 flex items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-indigo-500/10 border border-indigo-400/20 animate-ping" />
                <div className="w-12 h-12 rounded-full bg-indigo-950 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Tv className="w-6 h-6 animate-pulse" />
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-black font-mono tracking-wider " style={{ fontSize: '9px' }}>
                  CONECTADO ✔
                </span>
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-sans">
                  Sinal Ativo • Canal Ocioso
                </h4>
                <p className="text-[10px] text-slate-400 max-w-xs leading-relaxed font-sans mt-1">
                  Esta Smart TV está pareada e pronta. Use o Painel ou o Controle Remoto para sintonizar uma mídia ou playlist.
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={activeAsset.assetId || activeAsset.id || activeAsset.name || playlistIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 w-full h-full flex flex-col"
          >
            {/* 1. TEXT BULLETIN CARD */}
            {activeAsset.type === 'text' && (
              <div 
                className="w-full h-full flex flex-col justify-center p-12 sm:p-24 overflow-hidden relative"
                style={{ 
                  backgroundColor: activeAsset.config?.backgroundColor || '#0f172a',
                  color: activeAsset.config?.textColor || '#ffffff'
                }}
              >
                <div 
                  className="font-serif leading-relaxed text-balance"
                  style={{ 
                    textAlign: activeAsset.config?.textAlign || 'center',
                    fontFamily: activeAsset.config?.fontFamily === 'sans' ? 'sans-serif' : activeAsset.config?.fontFamily === 'mono' ? 'Courier New, monospace' : 'Georgia, serif',
                    fontSize: 
                      activeAsset.config?.fontSize === 'sm' ? '1.25rem' :
                      activeAsset.config?.fontSize === 'md' ? '1.75rem' :
                      activeAsset.config?.fontSize === 'lg' ? '2.25rem' :
                      activeAsset.config?.fontSize === 'xl' ? '3rem' :
                      activeAsset.config?.fontSize === '2xl' ? '4.25rem' : '5rem' // giant display text sizes
                  }}
                >
                  {activeAsset.content}
                </div>
              </div>
            )}

            {/* 2. IMAGE CONTENT */}
            {activeAsset.type === 'image' && (
              <div className="w-full h-full relative bg-black">
                {countdown !== null && countdown > 0 ? (
                  <div className="absolute inset-0 bg-black flex flex-col items-center justify-center p-6 text-center select-none z-50">
                    <div className="space-y-6 flex flex-col items-center justify-center">
                      <VitrionLogo variant="full" size="lg" theme="dark" className="animate-pulse" />
                      
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">
                          Próxima Imagem Em
                        </span>
                        <div className="text-8xl sm:text-9xl font-mono font-black text-white bg-white/5 border border-white/10 rounded-3xl w-32 h-32 sm:w-44 sm:h-44 flex items-center justify-center shadow-2xl tracking-tighter transition-all duration-300">
                          {countdown}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-indigo-400 font-mono uppercase tracking-wider animate-pulse">
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-ping"></span>
                        Preparando exibição...
                      </div>
                    </div>
                  </div>
                ) : (
                  <img 
                    src={activeAsset.url} 
                    alt="" 
                    className="w-full h-full object-cover" 
                    referrerPolicy="no-referrer"
                  />
                )}
              </div>
            )}

            {/* 3. VIDEO CONTENT */}
            {activeAsset.type === 'video' && (
              <div 
                className="w-full h-full relative bg-black" 
                style={{ display: isOffBySchedule ? 'none' : 'block' }}
              >
                <video 
                  ref={videoRef}
                  src={activeAsset.url} 
                  muted 
                  loop 
                  autoPlay 
                  playsInline
                  className="w-full h-full object-cover" 
                />
              </div>
            )}

            {/* 4. WEBSITE / EMBED CONTENT */}
            {activeAsset.type === 'web' && (
              <div className="w-full h-full relative bg-slate-900">
                <iframe 
                  src={activeAsset.url} 
                  title="TV signage webpage embed"
                  className="w-full h-full border-0" 
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Embedded hidden control bar that appears on cursor movements at the very bottom corner */}
      <div className="absolute bottom-4 left-4 z-40 bg-slate-950/80 backdrop-blur-md p-1.5 rounded-lg border border-white/5 opacity-0 hover:opacity-100 transition duration-300 flex items-center">
        <button
          onClick={handleToggleFullscreen}
          className="text-white hover:text-indigo-400 p-1 transition cursor-pointer"
          title="Alternar Tela Cheia"
        >
          <Maximize className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
