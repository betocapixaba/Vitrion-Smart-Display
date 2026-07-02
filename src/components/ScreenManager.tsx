import React, { useState, useEffect, useRef } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  db,
  auth,
  handleFirestoreError,
  OperationType,
  logAdminAction,
} from "../lib/firebase";
import { Screen, Playlist, Asset, PlaylistItem } from "../types";
import {
  Tv,
  Sparkles,
  Trash2,
  ShieldCheck,
  Play,
  HelpCircle,
  AlertCircle,
  Smartphone,
  Monitor,
  RefreshCw,
  Layers,
  CheckCircle,
  Info,
  ExternalLink,
  Check,
  Copy,
  Search,
  Calendar,
  Pencil,
  X,
  Building,
  Clock,
  Power,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  GripVertical,
} from "lucide-react";

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

function isScheduledOff(screenDoc: any): boolean {
  if (!screenDoc || !screenDoc.schedule) return false;

  const { dayIndex, timeStr: currentTimeStr } = getBrasiliaTimeParts();
  const daysKeys = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const dayKey = daysKeys[dayIndex];

  const dayConfig = screenDoc.schedule[dayKey];
  if (!dayConfig || !dayConfig.enabled) {
    return false; // If disabled or not set for this day, don't show black screen
  }

  const { startTime, endTime } = dayConfig;
  if (!startTime || !endTime) return false;

  if (startTime <= endTime) {
    return currentTimeStr < startTime || currentTimeStr >= endTime;
  } else {
    // Overnight schedule
    return currentTimeStr >= endTime && currentTimeStr < startTime;
  }
}

export default function ScreenManager() {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Search parameters
  const [searchTerm, setSearchTerm] = useState("");

  // Edit Panel dialog states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingScreen, setEditingScreen] = useState<Screen | null>(null);
  const [editScreenName, setEditScreenName] = useState("");
  const [editScreenClientId, setEditScreenClientId] = useState("");
  const [editScreenSchedule, setEditScreenSchedule] = useState<
    Record<string, any>
  >({});

  // Edit Client states
  const [isEditClientModalOpen, setIsEditClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [editClientEstName, setEditClientEstName] = useState("");
  const [editClientOwnerName, setEditClientOwnerName] = useState("");
  const [editClientPhone, setEditClientPhone] = useState("");
  const [editClientCity, setEditClientCity] = useState("");
  const [editClientState, setEditClientState] = useState("");
  const [editClientPlanId, setEditClientPlanId] = useState("");
  const [editClientVencimento, setEditClientVencimento] = useState("");

  // Pairing inputs
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingMode, setPairingMode] = useState<"pairCode" | "createDirect">(
    "pairCode",
  );
  const [pairingCodeInput, setPairingCodeInput] = useState("");
  const [screenNameInput, setScreenNameInput] = useState("");
  const [pairingClientId, setPairingClientId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Active simulated screen state
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [confirmDeleteScreenId, setConfirmDeleteScreenId] = useState<
    string | null
  >(null);
  const [confirmClientStandbyId, setConfirmClientStandbyId] = useState<
    string | null
  >(null);
  const [confirmClientUnpairAllId, setConfirmClientUnpairAllId] = useState<
    string | null
  >(null);

  // Custom tabs and pricing plans
  const [activeTab, setActiveTab] = useState<"individual" | "by-client">(
    "by-client",
  );
  const [clientSortType, setClientSortType] = useState<
    "custom" | "alphabetical" | "maxScreens" | "vencimento"
  >("custom");
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);

  // Simulated playback state (for the embedded TV viewer)
  const [simulatedAsset, setSimulatedAsset] = useState<any>(null);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [simulatedPlaylistItems, setSimulatedPlaylistItems] = useState<
    PlaylistItem[]
  >([]);

  // Expanded/Retracted state for client display lists
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [collapsedClientIds, setCollapsedClientIds] = useState<
    Record<string, boolean>
  >({});

  const toggleClientCollapse = (clientId: string) => {
    setCollapsedClientIds((prev) => ({
      ...prev,
      [clientId]: !prev[clientId],
    }));
  };

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = () => {
      if (auth.currentUser) {
        setCurrentUserId(auth.currentUser.uid);
      } else {
        if (typeof window !== "undefined") {
          try {
            const saved = localStorage.getItem("vitrion_active_admin");
            if (saved) {
              const parsed = JSON.parse(saved);
              if (parsed && parsed.uid) {
                setCurrentUserId(parsed.uid);
                return;
              }
            }
          } catch (e) {
            console.warn("Error reading active admin from localStorage:", e);
          }
        }
        setCurrentUserId(null);
      }
    };

    checkAuth();
    const unsubscribe = auth.onAuthStateChanged(() => {
      checkAuth();
    });
    return () => unsubscribe();
  }, []);

  const hasAutoSelected = useRef(false);

  // Sync Screens, Playlists, Assets & Clients
  useEffect(() => {
    if (!currentUserId) {
      hasAutoSelected.current = false;
      return;
    }

    // Screens
    const screenQuery = query(collection(db, "screens"));
    const unsubscribeScreens = onSnapshot(
      screenQuery,
      (snapshot) => {
        const list: Screen[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name || "Sem Nome",
            pairingCode: d.pairingCode || "",
            status: d.status || "offline",
            lastActive: d.lastActive,
            contentType: d.contentType || "idle",
            contentId: d.contentId || "",
            pairedAt: d.pairedAt,
            ownerId: d.ownerId || "",
            clientId: d.clientId || "",
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            deviceTime: d.deviceTime,
          });
        });
        setScreens(list);

        // Auto-select first screen if nothing selected
        if (list.length > 0 && !hasAutoSelected.current) {
          setSelectedScreenId((prev) => prev || list[0].id);
          hasAutoSelected.current = true;
        }
        setIsLoading(false);
      },
      (err) => {
        setIsLoading(false);
        handleFirestoreError(err, OperationType.LIST, "screens");
      },
    );

    // Playlists (for drop-down mappings)
    const playlistQuery = query(collection(db, "playlists"));
    const unsubscribePlaylists = onSnapshot(
      playlistQuery,
      (snapshot) => {
        const list: Playlist[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name || "",
            items: d.items || [],
            ownerId: d.ownerId || "",
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          });
        });
        setPlaylists(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, "playlists");
      },
    );

    // Assets (for drop-down mappings)
    const assetQuery = query(collection(db, "assets"));
    const unsubscribeAssets = onSnapshot(
      assetQuery,
      (snapshot) => {
        const list: Asset[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: docSnap.id,
            name: d.name || "",
            type: d.type || "text",
            url: d.url || "",
            content: d.content || "",
            config: d.config || {},
            duration: d.duration || 10,
            ownerId: d.ownerId || "",
            clientId: d.clientId || "",
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          });
        });
        setAssets(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, "assets");
      },
    );

    // Clients (for mapping screens and lists)
    const clientsQuery = query(collection(db, "clients"));
    const unsubscribeClients = onSnapshot(
      clientsQuery,
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({
            id: docSnap.id,
            ...docSnap.data(),
          });
        });
        // Sort by orderIndex first, fallback to alphabetically by establishmentName
        list.sort((a, b) => {
          const orderA = a.orderIndex !== undefined ? a.orderIndex : 0;
          const orderB = b.orderIndex !== undefined ? b.orderIndex : 0;
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          const nameA = a.establishmentName || "";
          const nameB = b.establishmentName || "";
          return nameA.localeCompare(nameB);
        });
        setClients(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, "clients");
      },
    );

    // Plans (for mapping plan names in client listings)
    const plansQuery = query(collection(db, "plans"));
    const unsubscribePlans = onSnapshot(
      plansQuery,
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        setPlans(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, "plans");
      },
    );

    return () => {
      unsubscribeScreens();
      unsubscribePlaylists();
      unsubscribeAssets();
      unsubscribeClients();
      unsubscribePlans();
    };
  }, [currentUserId]);

  // Live TV Simulator Logic (Runs the loop for the currently selected screen)
  useEffect(() => {
    if (!selectedScreenId) {
      setSimulatedAsset(null);
      setSimulatedPlaylistItems([]);
      return;
    }

    const currentScreen = screens.find((s) => s.id === selectedScreenId);
    if (
      !currentScreen ||
      currentScreen.contentType === "idle" ||
      currentScreen.contentType === "standby" ||
      currentScreen.contentType === "stopped"
    ) {
      setSimulatedAsset(null);
      setSimulatedPlaylistItems([]);
      return;
    }

    if (currentScreen.contentType === "asset") {
      const match = assets.find((a) => a.id === currentScreen.contentId);
      setSimulatedAsset(match || null);
      setSimulatedPlaylistItems([]);
    } else if (currentScreen.contentType === "playlist") {
      const activePlaylist = playlists.find(
        (p) => p.id === currentScreen.contentId,
      );
      if (!activePlaylist || activePlaylist.items.length === 0) {
        setSimulatedAsset(null);
        setSimulatedPlaylistItems([]);
        return;
      }

      const newItems = activePlaylist.items || [];
      setSimulatedPlaylistItems((prev) => {
        const isSame =
          prev.length === newItems.length &&
          prev.every(
            (item, idx) =>
              item.assetId === newItems[idx].assetId &&
              item.duration === newItems[idx].duration,
          );
        if (isSame) return prev;
        setPlaylistIndex(0);
        return newItems;
      });
    }
  }, [
    selectedScreenId,
    screens.find((s) => s.id === selectedScreenId)?.contentType,
    screens.find((s) => s.id === selectedScreenId)?.contentId,
    playlists,
    assets,
  ]);

  // Loop timer for Simulated Playlist sequences in Admin Panel
  useEffect(() => {
    if (simulatedPlaylistItems.length === 0) {
      return;
    }

    const index =
      playlistIndex >= simulatedPlaylistItems.length ? 0 : playlistIndex;
    if (index !== playlistIndex) {
      setPlaylistIndex(index);
    }

    const activeItem = simulatedPlaylistItems[index];
    setSimulatedAsset(activeItem);

    const nextIndex = (index + 1) % simulatedPlaylistItems.length;
    const itemDurationMs = (activeItem.duration || 10) * 1000;

    const timeoutId = setTimeout(() => {
      setPlaylistIndex(nextIndex);
    }, itemDurationMs);

    return () => clearTimeout(timeoutId);
  }, [simulatedPlaylistItems, playlistIndex]);

  // Handle Pairing Linking
  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (pairingMode === "createDirect") {
      if (!screenNameInput.trim()) {
        setErrorMsg("Por favor, informe um nome para identificar a tela.");
        return;
      }

      try {
        let generatedCode = "";
        let exists = true;
        let attempts = 0;

        while (exists && attempts < 10) {
          const possible = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          let code = "";
          for (let i = 0; i < 4; i++) {
            code += possible.charAt(
              Math.floor(Math.random() * possible.length),
            );
          }
          const checkDocRef = doc(db, "screens", code);
          const checkDoc = await getDoc(checkDocRef);
          if (!checkDoc.exists()) {
            generatedCode = code;
            exists = false;
          }
          attempts++;
        }

        if (!generatedCode) {
          generatedCode = "TV" + Math.floor(100 + Math.random() * 900);
        }

        await setDoc(doc(db, "screens", generatedCode), {
          id: generatedCode,
          name: screenNameInput.trim(),
          pairingCode: generatedCode,
          ownerId: currentUserId || "vitrion-sandbox-admin",
          clientId: pairingClientId || "",
          pairedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          status: "offline",
          contentType: "idle",
          contentId: "",
        });

        await logAdminAction(
          "CREATE_SCREEN_DIRECT",
          `Monitor: ${screenNameInput.trim()} (${generatedCode})`,
          `Criou monitor direto sem limites de plano de plano para o cliente ID: ${pairingClientId || "Geral"}.`,
        );

        setSuccessMsg(
          `Monitor "${screenNameInput.trim()}" criado diretamente com o Cód: ${generatedCode}!`,
        );
        setPairingCodeInput("");
        setScreenNameInput("");
        setPairingClientId("");
        setTimeout(() => {
          setPairingOpen(false);
          setSuccessMsg("");
        }, 3000);
      } catch (err) {
        setErrorMsg("Falha ao criar monitor diretamente.");
        console.error(err);
      }
      return;
    }

    const parsedCode = pairingCodeInput.trim().toUpperCase();
    if (parsedCode.length !== 4) {
      setErrorMsg(
        "O código de pareamento deve conter exatamente 4 caracteres.",
      );
      return;
    }

    if (!screenNameInput.trim()) {
      setErrorMsg("Por favor, informe um nome para identificar a tela.");
      return;
    }

    try {
      // Look up and examine reference document /screens/{parsedCode}
      const ref = doc(db, "screens", parsedCode);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        setErrorMsg(
          "Estação não encontrada! Certifique-se de que a Smart TV está aberta no Modo Player e gerou o código de 4 dígitos correto.",
        );
        return;
      }

      const screenData = snap.data();
      if (screenData.ownerId) {
        setErrorMsg(
          "Este monitor já se encontra pareado sob a administração de outro gestor de contas.",
        );
        return;
      }

      // Update Screen document to assign to this Admin!
      await updateDoc(ref, {
        name: screenNameInput.trim(),
        ownerId: currentUserId || "vitrion-sandbox-admin",
        clientId: pairingClientId || "",
        pairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "online",
      });

      setSuccessMsg(
        `Monitor "${screenNameInput.trim()}" integrado com sucesso!`,
      );
      setPairingCodeInput("");
      setScreenNameInput("");
      setPairingClientId("");
      setTimeout(() => {
        setPairingOpen(false);
        setSuccessMsg("");
      }, 2000);
    } catch (err) {
      setErrorMsg("Falha na segurança ao parear estação.");
      console.error(err);
    }
  };

  // Change active screen contents
  const assignContentToScreen = async (
    screenId: string,
    contentType: "idle" | "asset" | "playlist" | "standby" | "stopped",
    contentId: string,
  ) => {
    try {
      await updateDoc(doc(db, "screens", screenId), {
        contentType,
        contentId,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `screens/${screenId}`);
    }
  };

  // Toggle individual screen on / off (exhibition status)
  const handleTogglePower = async (
    screenId: string,
    currentType: "playlist" | "asset" | "idle" | "standby" | "stopped",
    contentId: string,
  ) => {
    try {
      if (currentType === "stopped") {
        // Toggle ON: restore previous type or fallback to idle
        let newType: "playlist" | "asset" | "idle" | "standby" = "idle";
        if (contentId) {
          const isPlaylist = playlists.some((p) => p.id === contentId);
          const isAsset = assets.some((a) => a.id === contentId);
          if (isPlaylist) {
            newType = "playlist";
          } else if (isAsset) {
            newType = "asset";
          }
        }
        await updateDoc(doc(db, "screens", screenId), {
          contentType: newType,
          updatedAt: serverTimestamp(),
        });
        setSuccessMsg("O monitor foi ligado com sucesso!");
        setTimeout(() => setSuccessMsg(""), 2000);
      } else {
        // Toggle OFF: set to stopped
        await updateDoc(doc(db, "screens", screenId), {
          contentType: "stopped",
          updatedAt: serverTimestamp(),
        });
        setSuccessMsg("O monitor foi desligado (Exibição Parada)!");
        setTimeout(() => setSuccessMsg(""), 2000);
      }
    } catch (err) {
      console.error("Erro ao alternar energia da tela:", err);
      setErrorMsg("Falha ao alternar a exibição da tela.");
    }
  };

const safeConfirm = (message: string): boolean => {
  try {
    return window.confirm(message);
  } catch (e) {
    console.warn("window.confirm was blocked or failed. Auto-confirming action.", e);
    return true;
  }
};

  // Permanently delete screen from Firestore database
  const handleUnpairScreen = async (screenId: string, skipConfirm = false) => {
    if (
      !skipConfirm &&
      !safeConfirm(
        "Deseja realmente EXCLUIR este monitor/display permanentemente do sistema? Esta ação apagará o registro da TV no banco de dados.",
      )
    )
      return;
    try {
      await deleteDoc(doc(db, "screens", screenId));
      if (selectedScreenId === screenId) {
        setSelectedScreenId(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `screens/${screenId}`);
    }
  };

  const handleClientStandby = async (clientId: string, skipConfirm = false) => {
    const clientScreens = screens.filter((s) => s.clientId === clientId);
    if (clientScreens.length === 0) {
      setErrorMsg(
        "Nenhuma TV vinculada a este cliente para colocar em standby.",
      );
      setTimeout(() => setErrorMsg(""), 4000);
      return;
    }
    if (
      !skipConfirm &&
      !safeConfirm("Colocar todas as TVs deste cliente em Standby?")
    )
      return;
    try {
      for (const screen of clientScreens) {
        await updateDoc(doc(db, "screens", screen.id), {
          contentType: "standby",
          updatedAt: serverTimestamp(),
        });
      }
      setSuccessMsg("Todas as TVs do cliente foram colocadas em Standby!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao aplicar standby nas TVs do cliente.");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  };

  const handleClientActive = async (clientId: string) => {
    const clientScreens = screens.filter((s) => s.clientId === clientId);
    if (clientScreens.length === 0) {
      setErrorMsg("Nenhuma TV vinculada a este cliente.");
      setTimeout(() => setErrorMsg(""), 4000);
      return;
    }
    try {
      for (const screen of clientScreens) {
        await updateDoc(doc(db, "screens", screen.id), {
          contentType: "idle",
          updatedAt: serverTimestamp(),
        });
      }
      setSuccessMsg(
        "Todas as TVs do cliente foram ativas/ligadas com sucesso!",
      );
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao reativar as TVs do cliente.");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  };

  const handleClientUnpairAll = async (
    clientId: string,
    skipConfirm = false,
  ) => {
    const clientScreens = screens.filter((s) => s.clientId === clientId);
    if (clientScreens.length === 0) {
      setErrorMsg("Nenhuma TV de cliente vinculada.");
      setTimeout(() => setErrorMsg(""), 4000);
      return;
    }
    if (
      !skipConfirm &&
      !safeConfirm(
        "Tem certeza que deseja desvincular TODAS as TVs integradas a este cliente? Elas retornarão ao modo de pareamento original.",
      )
    )
      return;
    try {
      for (const screen of clientScreens) {
        await updateDoc(doc(db, "screens", screen.id), {
          name: "Smart TV",
          ownerId: "",
          pairedAt: null,
          clientId: "",
          contentType: "idle",
          contentId: "",
          status: "online",
          updatedAt: serverTimestamp(),
        });
      }
      setSuccessMsg("Todas as TVs do cliente foram desvinculadas!");
      setTimeout(() => setSuccessMsg(""), 3505);
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao desvincular as TVs do cliente.");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  };

  const formatFullDateTime = (ts: any) => {
    if (!ts) return "N/A";
    const date = ts.seconds
      ? new Date(ts.seconds * 1000)
      : ts.toDate
        ? ts.toDate()
        : new Date(ts);
    const daysOfWeek = [
      "Domingo",
      "Segunda-feira",
      "Terça-feira",
      "Quarta-feira",
      "Quinta-feira",
      "Sexta-feira",
      "Sábado",
    ];
    const dayName = daysOfWeek[date.getDay()];
    const formattedDate = date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const formattedTime = date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${dayName}, ${formattedDate} às ${formattedTime}`;
  };

  const openEditScreenModal = (screen: Screen) => {
    setEditingScreen(screen);
    setEditScreenName(screen.name);
    setEditScreenClientId(screen.clientId || "");

    // Initialize schedule
    const existing = screen.schedule || {};
    const defaultSched: any = {};
    [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ].forEach((day) => {
      defaultSched[day] = {
        enabled: existing[day]?.enabled ?? false,
        startTime: existing[day]?.startTime || "08:00",
        endTime: existing[day]?.endTime || "18:00",
      };
    });
    setEditScreenSchedule(defaultSched);
    setIsEditModalOpen(true);
  };

  const handleSaveScreenDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingScreen) return;
    try {
      const ref = doc(db, "screens", editingScreen.id);
      await updateDoc(ref, {
        name: editScreenName.trim(),
        clientId: editScreenClientId || "",
        schedule: editScreenSchedule,
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg(`Configurações de "${editScreenName.trim()}" atualizadas!`);
      setIsEditModalOpen(false);
      setEditingScreen(null);
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao atualizar as configurações do monitor.");
    }
  };

  const handleSaveClientDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;
    try {
      const ref = doc(db, "clients", editingClient.id);
      await updateDoc(ref, {
        establishmentName: editClientEstName.trim(),
        name: editClientOwnerName.trim(),
        phone: editClientPhone.trim(),
        city: editClientCity.trim(),
        state: editClientState.trim().toUpperCase(),
        planId: editClientPlanId,
        vencimento: editClientVencimento.trim(),
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg(
        `Cadastro de "${editClientEstName.trim()}" atualizado com sucesso!`,
      );
      setIsEditClientModalOpen(false);
      setEditingClient(null);
      setTimeout(() => setSuccessMsg(""), 2500);

      await logAdminAction(
        "UPDATE_CLIENT_QUICK",
        `Cliente: ${editClientEstName.trim()}`,
        `Atualizou dados cadastrais (rápido) do estabelecimento na Central de Distribuição.`,
      );
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao atualizar o cadastro do cliente.");
      setTimeout(() => setErrorMsg(""), 4000);
    }
  };

  const filteredScreens = screens.filter((screen) => {
    const term = searchTerm.toLowerCase();
    const client = clients.find((c) => c.id === screen.clientId);
    const clientName = client ? client.establishmentName.toLowerCase() : "";

    const pairDateFormatted = formatFullDateTime(
      screen.pairedAt || screen.createdAt,
    ).toLowerCase();

    return (
      screen.name.toLowerCase().includes(term) ||
      screen.pairingCode.toLowerCase().includes(term) ||
      screen.id.toLowerCase().includes(term) ||
      clientName.includes(term) ||
      pairDateFormatted.includes(term)
    );
  });

  const filteredClients = clients
    .filter((client) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();

      const clientScreens = screens.filter((s) => s.clientId === client.id);
      const matchesScreens = clientScreens.some(
        (scr) =>
          scr.name.toLowerCase().includes(term) ||
          scr.pairingCode.toLowerCase().includes(term),
      );

      return (
        (client.establishmentName || "").toLowerCase().includes(term) ||
        (client.name || "").toLowerCase().includes(term) ||
        (client.city || "").toLowerCase().includes(term) ||
        (client.state || "").toLowerCase().includes(term) ||
        matchesScreens
      );
    })
    .sort((a, b) => {
      if (clientSortType === "alphabetical") {
        const nameA = a.establishmentName || "";
        const nameB = b.establishmentName || "";
        return nameA.localeCompare(nameB, "pt-BR", { sensitivity: "base" });
      }
      if (clientSortType === "maxScreens") {
        const screensA = screens.filter((s) => s.clientId === a.id).length;
        const screensB = screens.filter((s) => s.clientId === b.id).length;
        if (screensA !== screensB) {
          return screensB - screensA;
        }
        const nameA = a.establishmentName || "";
        const nameB = b.establishmentName || "";
        return nameA.localeCompare(nameB, "pt-BR", { sensitivity: "base" });
      }
      if (clientSortType === "vencimento") {
        const dateA = a.vencimento || "9999-12-31";
        const dateB = b.vencimento || "9999-12-31";
        if (dateA !== dateB) {
          return dateA.localeCompare(dateB);
        }
        const nameA = a.establishmentName || "";
        const nameB = b.establishmentName || "";
        return nameA.localeCompare(nameB, "pt-BR", { sensitivity: "base" });
      }
      // 'custom' manual order index
      const orderA = a.orderIndex !== undefined ? a.orderIndex : 0;
      const orderB = b.orderIndex !== undefined ? b.orderIndex : 0;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const nameA = a.establishmentName || "";
      const nameB = b.establishmentName || "";
      return nameA.localeCompare(nameB, "pt-BR", { sensitivity: "base" });
    });

  // Handle fixing current sorted order dynamically as the new default manual order
  const handleFixCurrentOrder = async () => {
    if (isSavingOrder) return;
    setIsSavingOrder(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const updatedList = [...filteredClients];
      for (let i = 0; i < updatedList.length; i++) {
        const client = updatedList[i];
        const newIndex = (i + 1) * 10;
        await updateDoc(doc(db, "clients", client.id), {
          orderIndex: newIndex,
          updatedAt: serverTimestamp(),
        });
      }

      await logAdminAction(
        "FIX_CLIENTS_DISPLAY_ORDER",
        `Tipo de Ordem Ficticia: ${clientSortType}`,
        `Fixou a ordenação do tipo "${clientSortType}" como a nova ordem manual do painel.`,
      );

      setClientSortType("custom");
      setSuccessMsg(
        "Ordem de exibição atual salva com sucesso como nova ordem manual padrão!",
      );
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error("Error fixing order:", err);
      setErrorMsg("Erro ao gravar nova ordem no sistema.");
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Handle customer row dynamic persistent reordering
  const handleReorder = async (
    currentIndex: number,
    direction: "up" | "down",
  ) => {
    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= filteredClients.length) return;

    setErrorMsg("");
    setSuccessMsg("");
    try {
      const clientA = filteredClients[currentIndex];
      const clientB = filteredClients[targetIndex];

      // To make reordering completely persistent and simple, find both elements in our full 'clients' array
      // and set explicit sequence indices if any is undefined
      const updatedList = [...clients];

      // Initialize indices sequentially for any that is missing
      updatedList.forEach((c, idx) => {
        if (c.orderIndex === undefined) {
          c.orderIndex = idx * 10;
        }
      });

      const idxA = updatedList.findIndex((c) => c.id === clientA.id);
      const idxB = updatedList.findIndex((c) => c.id === clientB.id);

      if (idxA !== -1 && idxB !== -1) {
        // Swap their orderIndex
        const tempOrder = updatedList[idxA].orderIndex;
        updatedList[idxA].orderIndex = updatedList[idxB].orderIndex;
        updatedList[idxB].orderIndex = tempOrder;

        // Persist to document snapshots
        await updateDoc(doc(db, "clients", clientA.id), {
          orderIndex: updatedList[idxA].orderIndex,
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, "clients", clientB.id), {
          orderIndex: updatedList[idxB].orderIndex,
          updatedAt: serverTimestamp(),
        });

        await logAdminAction(
          "REORDER_CLIENTS_SCREEN_MANAGER",
          `Clientes: ${clientA.establishmentName}`,
          `Alterou a ordem de exibição dos clientes "${clientA.establishmentName}" e "${clientB.establishmentName}" no gerenciador de telas.`,
        );

        setSuccessMsg("Ordenação dos clientes atualizada com sucesso!");
        setTimeout(() => setSuccessMsg(""), 3000);
      }
    } catch (err) {
      console.error("Error reordering clients:", err);
      setErrorMsg("Erro ao persistir a nova ordenação de clientes.");
    }
  };

  // Drag and drop reordering function for clients/monitors list
  const handleDragReorder = async (fromIndex: number, toIndex: number) => {
    if (
      fromIndex < 0 ||
      fromIndex >= filteredClients.length ||
      toIndex < 0 ||
      toIndex >= filteredClients.length
    )
      return;

    setErrorMsg("");
    setSuccessMsg("");
    try {
      const reorderedList = [...filteredClients];
      const [movedItem] = reorderedList.splice(fromIndex, 1);
      reorderedList.splice(toIndex, 0, movedItem);

      // Save new sequential orderIndex values to ensure persistence in Firestore
      for (let i = 0; i < reorderedList.length; i++) {
        const c = reorderedList[i];
        const newOrderIndex = i * 10;
        await updateDoc(doc(db, "clients", c.id), {
          orderIndex: newOrderIndex,
          updatedAt: serverTimestamp(),
        });
      }

      await logAdminAction(
        "REORDER_CLIENTS_DRAG_AND_DROP",
        `Reordenador de Clientes`,
        `Reordenou a ordem dos clientes de forma manual e personalizada.`,
      );

      setSuccessMsg("Ordenação dos clientes atualizada com sucesso!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      console.error("Error with drag and drop reordering:", err);
      setErrorMsg(
        "Erro ao persistir a nova ordenação de clientes via arrastar.",
      );
    }
  };

  const isScreenOnline = (screen: Screen) => {
    if (!screen.lastActive) return false;
    const seconds = (screen.lastActive as any).seconds;
    const lastActiveMs = seconds
      ? seconds * 1000
      : new Date(screen.lastActive as any).getTime();
    if (isNaN(lastActiveMs)) return false;
    const deltaSeconds = (Date.now() - lastActiveMs) / 1000;
    return deltaSeconds < 65;
  };

  const getSyncOffsetInfo = (screen: Screen) => {
    if (!screen.deviceTime || !screen.lastActive) {
      return {
        status: 'unknown',
        text: 'Aguardando pulso...',
        color: 'text-slate-500 bg-slate-50 border-slate-200/50',
        offsetSeconds: 0
      };
    }

    const seconds = (screen.lastActive as any).seconds;
    const lastActiveMs = seconds
      ? seconds * 1000
      : new Date(screen.lastActive as any).getTime();
    if (isNaN(lastActiveMs)) {
      return {
        status: 'unknown',
        text: 'Aguardando pulso...',
        color: 'text-slate-500 bg-slate-50 border-slate-200/50',
        offsetSeconds: 0
      };
    }

    const offsetSeconds = Math.round((screen.deviceTime - lastActiveMs) / 1000);
    const absOffset = Math.abs(offsetSeconds);

    if (absOffset < 30) {
      return {
        status: 'in-sync',
        text: 'Perfeitamente Sincronizado',
        color: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20',
        offsetSeconds
      };
    } else {
      let timeText = '';
      if (absOffset < 3600) {
        const minutes = Math.floor(absOffset / 60);
        const remainingSeconds = absOffset % 60;
        timeText = `${minutes}m ${remainingSeconds}s`;
      } else {
        const hours = Math.floor(absOffset / 3600);
        const minutes = Math.floor((absOffset % 3600) / 60);
        timeText = `${hours}h ${minutes}m`;
      }

      const direction = offsetSeconds > 0 ? 'Adiantada' : 'Atrasada';
      const isCritical = absOffset >= 300; // >= 5 minutes is critical for schedule sync

      return {
        status: isCritical ? 'critical' : 'warning',
        text: `Diferença: ${direction} ${timeText}`,
        color: isCritical 
          ? 'text-rose-700 bg-rose-500/10 border-rose-500/20 font-bold animate-pulse' 
          : 'text-amber-700 bg-amber-500/10 border-amber-500/20 font-semibold',
        offsetSeconds
      };
    }
  };

  const totalScreens = screens.length;
  const onlineScreens = screens.filter(isScreenOnline).length;
  const offlineScreens = Math.max(0, totalScreens - onlineScreens);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 font-sans">
            Gestão de Telas (TVs/Painéis)
          </h2>
          <p className="text-xs text-slate-500 font-sans mt-0.5">
            Gerencie os monitores conectados e distribua o conteúdo em tempo
            real.
          </p>
        </div>
        {!pairingOpen && (
          <button
            onClick={() => {
              setPairingMode("pairCode");
              setPairingClientId("");
              setScreenNameInput("");
              setPairingOpen(true);
            }}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition cursor-pointer"
          >
            <Tv className="w-4 h-4" />
            Parear Nova Tela
          </button>
        )}
      </div>

      {/* Premium Dashboard Metrics Shelf */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 border border-indigo-100 text-indigo-650 rounded-lg shrink-0">
            <Monitor className="w-4.5 h-4.5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400 leading-none">
              Total de Telas
            </span>
            <span className="text-lg font-bold font-mono text-slate-800 leading-tight block mt-1">
              {totalScreens}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-lg shrink-0">
            <div className="relative">
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <Tv className="w-4.5 h-4.5" />
            </div>
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400 leading-none">
              Monitores Online
            </span>
            <span className="text-lg font-bold font-mono text-emerald-600 leading-tight block mt-1">
              {onlineScreens}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs flex items-center gap-3">
          <div className="p-2.5 bg-slate-50 border border-slate-200 text-slate-400 rounded-lg shrink-0">
            <Power className="w-4.5 h-4.5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400 leading-none">
              Monitores Offline
            </span>
            <span className="text-lg font-bold font-mono text-slate-500 leading-tight block mt-1">
              {offlineScreens}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-3xs flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50/50 border border-indigo-100 text-indigo-650 rounded-lg shrink-0">
            <Building className="w-4.5 h-4.5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400 leading-none">
              Clientes Ativos
            </span>
            <span className="text-lg font-bold font-mono text-slate-700 leading-tight block mt-1">
              {clients.length}
            </span>
          </div>
        </div>
      </div>

      {/* Switcher Tab Navigation - Premium Capsule Segments */}
      <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1 select-none max-w-sm border border-slate-200/40">
        <button
          onClick={() => {
            setActiveTab("by-client");
            setSearchTerm("");
          }}
          className={`flex-1 py-1.5 px-3.5 text-xs font-semibold leading-none rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "by-client"
              ? "bg-white text-indigo-700 font-bold shadow-xs border border-slate-200/40"
              : "text-slate-550 hover:text-slate-800 hover:bg-white/40"
          }`}
        >
          🏢 Por Cliente
        </button>
        <button
          onClick={() => {
            setActiveTab("individual");
            setSearchTerm("");
          }}
          className={`flex-1 py-1.5 px-3.5 text-xs font-semibold leading-none rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "individual"
              ? "bg-white text-indigo-700 font-bold shadow-xs border border-slate-200/40"
              : "text-slate-550 hover:text-slate-800 hover:bg-white/40"
          }`}
        >
          🖥️ TVs Individuais ({totalScreens})
        </button>
      </div>

      {pairingOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden animate-scale-up select-none">
            <header className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-150 flex items-center justify-center text-indigo-600">
                  <Tv className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    {pairingMode === "createDirect"
                      ? "Criar ID de Monitor Direto"
                      : "Conectar Monitor Digital"}
                  </h3>
                  <p className="text-[10px] text-slate-450 mt-0.5">
                    Associe novos monitores e envie conteúdos remotos em tempo
                    real.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPairingOpen(false);
                  setErrorMsg("");
                }}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </header>

            <form onSubmit={handlePair} className="p-6 space-y-4">
              {/* Segmented control for choosing registration type */}
              <div className="bg-slate-100 p-0.5 rounded-lg flex items-center gap-1 select-none max-w-sm border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setPairingMode("pairCode");
                    setErrorMsg("");
                  }}
                  className={`flex-1 py-1 px-3 text-[10.5px] font-bold leading-none rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    pairingMode === "pairCode"
                      ? "bg-white text-indigo-700 font-extrabold shadow-3xs"
                      : "text-slate-550 hover:text-slate-800"
                  }`}
                >
                  🔑 Parear por Código
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPairingMode("createDirect");
                    setErrorMsg("");
                  }}
                  className={`flex-1 py-1 px-3 text-[10.5px] font-bold leading-none rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    pairingMode === "createDirect"
                      ? "bg-white text-indigo-700 font-extrabold shadow-3xs"
                      : "text-slate-550 hover:text-slate-800"
                  }`}
                >
                  ⚡ Criar Direto (Sem Limites)
                </button>
              </div>

              {pairingMode === "pairCode" ? (
                <p className="text-xs text-slate-600 leading-relaxed">
                  Abra o <strong>Modo Player</strong> em sua Smart TV (ou em uma
                  nova aba do navegador). Copie o código de 4 caracteres gerado
                  lá e insira abaixo para reivindicar o pareamento remoto:
                </p>
              ) : (
                <p className="text-xs text-indigo-900 leading-relaxed bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-150/40">
                  <strong>Monitor Direto / Sem Código:</strong> Esta opção gera
                  uma TV virtual diretamente, associando-a ao cliente
                  selecionado imediatamente{" "}
                  <strong>
                    sem consumir limites do plano e sem depender de código
                    físico
                  </strong>
                  . Você poderá abrir o player usando o link "Player Remoto".
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pairingMode === "pairCode" ? (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Código de 4 Dígitos *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={4}
                      value={pairingCodeInput}
                      onChange={(e) => setPairingCodeInput(e.target.value)}
                      placeholder="Ex: F9XQ"
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-xs font-bold font-mono tracking-wider focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Código de 4 Dígitos
                    </label>
                    <div className="w-full px-3 py-2 border border-slate-200 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold font-mono tracking-wider select-none leading-none flex items-center justify-start h-9">
                      [ Será gerado automático ]
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    Nome de Identificação *
                  </label>
                  <input
                    type="text"
                    required
                    value={screenNameInput}
                    onChange={(e) => setScreenNameInput(e.target.value)}
                    placeholder="Ex: Monitor Recepção principal"
                    className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* New Client Selector on pairing form */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Estabelecimento / Cliente Proprietário (Opcional)
                </label>
                <select
                  value={pairingClientId}
                  onChange={(e) => setPairingClientId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-xs leading-tight outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">-- Vincular a Nenhum (Geral) --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      🏢 {c.establishmentName} ({c.city} - {c.state})
                    </option>
                  ))}
                </select>
              </div>

              {errorMsg && (
                <div className="p-3 bg-red-50 text-red-700 text-xs font-semibold rounded-lg flex items-center gap-2 border border-red-200/50">
                  <AlertCircle className="w-4 h-4" />
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="p-3 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg flex items-center gap-2 border border-emerald-250/50">
                  <CheckCircle className="w-4 h-4" />
                  {successMsg}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPairingOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-250 text-slate-700 text-xs font-semibold rounded-lg border transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow transition cursor-pointer"
                >
                  {pairingMode === "createDirect"
                    ? "Criar Monitor Direto"
                    : "Parear Conexão"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Toast Success Alerts */}
      {successMsg && !pairingOpen && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-850 rounded-xl text-xs flex items-center gap-2 animate-fade-in shadow-xxs">
          <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Connected Screens List (Left) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          {/* Shared Search Bar for both tabs */}
          <div className="flex items-center gap-3 bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-xxs">
            <Search className="w-4.5 h-4.5 text-slate-400 shrink-0" />
            <input
              type="text"
              id="search-screens-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar por cliente, Smart TV, código (ex: F9XQ) ou cidade..."
              className="flex-1 bg-transparent border-0 outline-none placeholder-slate-400 text-xs text-slate-700 focus:ring-0"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="text-slate-400 hover:text-slate-600 text-xs font-mono px-1.5 py-0.5 hover:bg-slate-100 rounded"
              >
                Limpar
              </button>
            )}
          </div>

          {activeTab === "individual" ? (
            <>
              <div className="flex items-center justify-between">
                <span className="block text-xs font-semibold text-slate-700">
                  🖥️ Monitores Encontrados ({filteredScreens.length})
                </span>
              </div>

              {/* Quick Fire TV Helpful notice inside Control Panel */}
              <div className="bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/15 rounded-xl p-3.5 flex items-start gap-2.5 transition text-xs text-slate-600 leading-normal animate-fade-in shadow-xxs">
                <span className="text-base shrink-0 select-none">🔥</span>
                <div className="space-y-1">
                  <p className="font-bold text-amber-850 text-[11px] uppercase tracking-wider flex items-center gap-1.5 font-sans">
                    Conexão com Amazon Fire TV Stick
                  </p>
                  <p className="text-[10.5px] text-slate-600">
                    Para sinalizar em um **Fire TV Stick** ou Smart TV: abra o
                    navegador **Amazon Silk** na TV, acesse a URL deste app (ou
                    do QR code do player) com{" "}
                    <code className="bg-amber-550/10 px-1 py-0.2 rounded font-mono font-semibold">
                      ?mode=player
                    </code>{" "}
                    e use o botão central **OK / SELECT** do controle remoto
                    para alternar a tela cheia.
                  </p>
                </div>
              </div>

              {/* Monitor de Sincronização de Relógio (Vitrion Sync) */}
              {(() => {
                const onlineScreensList = screens.filter(isScreenOnline);
                const outOfSyncScreens = onlineScreensList.filter(s => {
                  const syncInfo = getSyncOffsetInfo(s);
                  return syncInfo.status === 'critical' || syncInfo.status === 'warning';
                });

                return (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-white space-y-3 shadow-sm animate-fade-in">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-lg">
                          <Clock className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                            Monitor de Sincronização de Relógio (Vitrion Sync)
                          </h4>
                          <p className="text-[10px] text-slate-400 leading-none mt-1">
                            Garante que os aparelhos executem o Programador Semanal no horário correto
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        ONLINE SYNC ACTIVE
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
                      <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between">
                        <span className="text-[10px] text-slate-450 uppercase tracking-wider font-bold">Aparelhos Ativos</span>
                        <span className="text-lg font-mono font-bold mt-1 text-slate-100">{onlineScreensList.length}</span>
                      </div>
                      <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between">
                        <span className="text-[10px] text-slate-450 uppercase tracking-wider font-bold">100% Sincronizados</span>
                        <span className="text-lg font-mono font-bold mt-1 text-emerald-400">
                          {onlineScreensList.length - outOfSyncScreens.length}
                        </span>
                      </div>
                      <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between">
                        <span className="text-[10px] text-slate-450 uppercase tracking-wider font-bold">Divergência de Hora</span>
                        <span className={`text-lg font-mono font-bold mt-1 ${outOfSyncScreens.length > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`}>
                          {outOfSyncScreens.length}
                        </span>
                      </div>
                    </div>

                    {outOfSyncScreens.length > 0 && (
                      <div className="bg-amber-500/10 border border-amber-500/15 rounded-lg p-2.5 text-[11px] text-amber-300 leading-normal flex items-start gap-2.5 animate-fade-in mt-1">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
                        <div>
                          <span className="font-bold uppercase tracking-wide block mb-0.5">Desvio de Sincronização Detectado</span>
                          <p>Há {outOfSyncScreens.length} dispositivo(s) online cuja hora interna está divergindo do servidor Vitrion. Isto fará com que o Programador Semanal (Modo Econômico) ative ou desative fora do horário correto configurado.</p>
                          <span className="block mt-1.5 font-bold text-slate-300">
                            👉 Dica: Ajuste o fuso horário (America/New_York) e ative a sincronização automática de data/hora nas configurações do sistema do seu Amazon Fire TV.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
                  <svg
                    className="animate-spin w-8 h-8"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span className="text-xs font-medium">
                    Buscando monitores conectados...
                  </span>
                </div>
              ) : filteredScreens.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
                  <Tv className="w-10 h-10 text-slate-350 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-700">
                    Nenhum Monitor Encontrado
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-5 leading-relaxed">
                    {searchTerm
                      ? "Nenhuma TV corresponde aos termos pesquisados. Verifique se digitou o código de pareamento correto."
                      : 'Nenhuma Smart TV está integrada a esta conta. Clique em "Parear Nova Tela" e use o código do player para sintonizá-la.'}
                  </p>
                  {!searchTerm && (
                    <button
                      type="button"
                      onClick={() => setPairingOpen(true)}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
                    >
                      Parear Meu Primeiro Dispositivo
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredScreens.map((screen) => {
                    const isSelected = selectedScreenId === screen.id;
                    const associatedClient = clients.find(
                      (c) => c.id === screen.clientId,
                    );

                    const isOnline = isScreenOnline(screen);

                    return (
                      <div
                        key={screen.id}
                        onClick={() => setSelectedScreenId(screen.id)}
                        className={`p-3 px-4 rounded-xl border flex flex-col xl:flex-row xl:items-center justify-between gap-4 transition-all cursor-pointer ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/10 shadow-sm ring-1 ring-indigo-500/25"
                            : "border-slate-200 bg-white hover:border-slate-350 hover:bg-slate-50 shadow-3xs"
                        }`}
                      >
                        {/* Column 1: TV Identifier (Icon + Name + Code) */}
                        <div className="flex-1 flex flex-col md:flex-row md:items-center justify-start gap-4 min-w-0">
                          <div className="flex items-center gap-3 w-full md:w-56 shrink-0 min-w-0">
                            <div
                              className={`p-2 rounded-lg shrink-0 ${isOnline ? "text-indigo-600 bg-indigo-100/50 border border-indigo-200/50" : "text-slate-400 bg-slate-100 border border-slate-200/40"}`}
                            >
                              <Tv className="w-4 h-4 shrink-0" />
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-slate-800 truncate block">
                                {screen.name}
                              </span>
                              <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-650 border border-slate-200 px-1.5 py-0.2 rounded shrink-0 inline-block mt-0.5">
                                CÓD: {screen.pairingCode}
                              </span>
                            </div>
                          </div>

                          {/* Column 2: Owner client info */}
                          <div className="w-full md:w-52 shrink-0 min-w-0">
                            {associatedClient ? (
                              <div className="text-[10px] text-indigo-850 bg-indigo-50/55 border border-indigo-100/40 px-2 py-1 rounded-md inline-flex items-center gap-1 max-w-full">
                                <Building className="w-3 h-3 text-indigo-500 shrink-0" />
                                <span className="truncate">
                                  Cliente:{" "}
                                  <strong>
                                    {associatedClient.establishmentName}
                                  </strong>
                                </span>
                              </div>
                            ) : (
                              <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-150 px-2 py-1 rounded-md inline-flex items-center gap-1">
                                <Building className="w-3 h-3 text-slate-400 shrink-0" />
                                <span className="italic">
                                  Geral / Sem Cliente
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Column 3: Content Signal status badge */}
                          <div className="flex items-center gap-1.5 min-w-0 md:w-56 shrink-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-350"}`}
                            />
                            <div className="min-w-0">
                              <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider leading-none">
                                Status de Sinal
                              </span>
                              <span className="text-xs font-semibold text-slate-700 truncate block mt-0.5">
                                {screen.contentType === "idle" &&
                                  "Ocioso (Sem programação)"}
                                {screen.contentType === "standby" &&
                                  "Standby / Descanso 💤"}
                                {screen.contentType === "stopped" &&
                                  "Desligado / Sem Transmissão 🛑"}
                                {screen.contentType === "asset" &&
                                  `Mídia: ${assets.find((a) => a.id === screen.contentId)?.name || "Carregando..."}`}
                                {screen.contentType === "playlist" &&
                                  `Playlist: ${playlists.find((a) => a.id === screen.contentId)?.name || "Carregando..."}`}
                              </span>
                            </div>
                          </div>

                          {/* Column 3.5: Clock Sincronização status badge */}
                          <div className="flex items-center gap-1.5 min-w-0 md:w-52 shrink-0">
                            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider leading-none">
                                Sincronização de Relógio
                              </span>
                              {(() => {
                                const syncInfo = getSyncOffsetInfo(screen);
                                return (
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md inline-block border mt-0.5 font-mono ${syncInfo.color}`}>
                                    {syncInfo.text}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>

                          {/* Column 4: Quick Links */}
                          <div className="flex flex-col gap-1.5 select-none font-mono" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5 bg-indigo-50/70 border border-indigo-100 p-1.5 px-2.5 rounded-lg max-w-full md:max-w-sm">
                              <span className="text-[9px] text-indigo-800 font-bold shrink-0 uppercase tracking-widest">
                                URL Silk:
                              </span>
                              <span 
                                className="font-mono text-[9.5px] text-indigo-600 truncate select-all flex-1 font-semibold" 
                                title={`${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`}
                              >
                                {`${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const url = `${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`;
                                  try {
                                    navigator.clipboard.writeText(url);
                                    setCopiedUrl(url);
                                    setTimeout(() => setCopiedUrl(null), 2000);
                                  } catch (err) {
                                    console.warn("Clipboard blocked", err);
                                  }
                                }}
                                className="p-1 text-indigo-600 hover:text-indigo-850 hover:bg-indigo-100/80 rounded transition shrink-0 cursor-pointer"
                                title="Copiar URL para o Amazon Silk Browser"
                              >
                                {copiedUrl === `${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600 font-bold" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <a
                                href={`${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 text-indigo-500 hover:text-indigo-800 hover:bg-indigo-100/80 rounded transition shrink-0"
                                title="Abrir Player (Salvar nos Favoritos do Silk)"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        </div>

                        {/* Right Column: Controls & Interactions */}
                        <div className="flex items-center justify-between md:justify-end gap-3 shrink-0 select-none">
                          {/* Power toggle */}
                          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-150 px-2 py-0.5 rounded-lg h-8">
                            <span
                              className={`text-[8.5px] font-black tracking-wider uppercase ${screen.contentType !== "stopped" ? "text-emerald-600" : "text-slate-400"}`}
                            >
                              {screen.contentType !== "stopped" ? "ON" : "OFF"}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTogglePower(
                                  screen.id,
                                  screen.contentType,
                                  screen.contentId,
                                );
                              }}
                              className={`w-8.5 h-4.5 rounded-full p-0.5 transition-colors duration-250 cursor-pointer ${
                                screen.contentType !== "stopped"
                                  ? "bg-emerald-500"
                                  : "bg-slate-350"
                              }`}
                              title={
                                screen.contentType !== "stopped"
                                  ? "Desligar Exibição"
                                  : "Ligar Exibição"
                              }
                            >
                              <div
                                className={`bg-white w-3.5 h-3.5 rounded-full shadow-xxs transform transition-transform duration-250 ${
                                  screen.contentType !== "stopped"
                                    ? "translate-x-4"
                                    : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          {/* Content drop selector */}
                          <select
                            value={`${screen.contentType}:${screen.contentId}`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const [cType, cId] = e.target.value.split(":");
                              assignContentToScreen(
                                screen.id,
                                cType as any,
                                cId,
                              );
                            }}
                            className="px-2 py-1 bg-white border border-slate-205 text-slate-705 rounded-lg text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none cursor-pointer h-8 max-w-[140px] md:max-w-[160px]"
                          >
                            <option value="idle:">-- Selecionar --</option>
                            <option value="standby:">Standby</option>
                            <option value="stopped:">Desligado 🛑</option>
                            <optgroup label="📋 Playlists">
                              {playlists.map((p) => (
                                <option key={p.id} value={`playlist:${p.id}`}>
                                  🔁 {p.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="🎯 Mídias">
                              {assets
                                .filter(
                                  (a) =>
                                    !a.clientId ||
                                    !screen.clientId ||
                                    a.clientId === screen.clientId,
                                )
                                .map((a) => (
                                  <option key={a.id} value={`asset:${a.id}`}>
                                    📺 {a.name}
                                  </option>
                                ))}
                            </optgroup>
                          </select>

                          {/* Action pencil / delete buttons */}
                          {confirmDeleteScreenId === screen.id ? (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg p-1 h-8 animate-fade-in shrink-0"
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnpairScreen(screen.id, true);
                                  setConfirmDeleteScreenId(null);
                                }}
                                className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-black uppercase transition cursor-pointer"
                              >
                                Sim
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteScreenId(null);
                                }}
                                className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-350 text-slate-750 rounded text-[9px] font-bold uppercase transition cursor-pointer"
                              >
                                Não
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-150 rounded-lg p-0.5 h-8">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditScreenModal(screen);
                                }}
                                className="p-1 text-slate-400 hover:text-indigo-650 hover:bg-white rounded transition"
                                title="Editar TV"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteScreenId(screen.id);
                                }}
                                className="p-1 text-slate-400 hover:text-red-500 hover:bg-white rounded transition"
                                title="Excluir TV"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            /* BY CLIENT LAYOUT */
            <div className="space-y-3 font-sans text-slate-700">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 p-3 rounded-xl">
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-slate-700">
                    🏢 Painel de Controle de TVs por Cliente (
                    {filteredClients.length})
                  </span>
                  <p className="text-[10px] text-slate-450 mt-0.5 font-sans leading-tight">
                    Organize e ordene a visualização dos seus clientes
                    cadastrados no painel.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] uppercase tracking-wider font-extrabold text-slate-401 font-mono">
                    Organizar por:
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-250/60 bg-white p-0.5 shadow-3xs">
                    <button
                      type="button"
                      onClick={() => setClientSortType("custom")}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        clientSortType === "custom"
                          ? "bg-indigo-600 text-white shadow-3xs"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                      }`}
                      title="Ordem Personalizada Manual (Reordene arrastando os estabelecimentos)"
                    >
                      🔀 Manual
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientSortType("alphabetical")}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        clientSortType === "alphabetical"
                          ? "bg-indigo-600 text-white shadow-3xs"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                      }`}
                      title="Ordem Alfabética (A-Z)"
                    >
                      🔤 Alfabético
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientSortType("maxScreens")}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        clientSortType === "maxScreens"
                          ? "bg-indigo-600 text-white shadow-3xs"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                      }`}
                      title="Clientes com mais Smart TVs conectadas primeiro"
                    >
                      📺 Mais TVs
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientSortType("vencimento")}
                      className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                        clientSortType === "vencimento"
                          ? "bg-indigo-600 text-white shadow-3xs"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                      }`}
                      title="Faturas / Vencimento mais próximo primeiro"
                    >
                      📅 Vencimento
                    </button>
                  </div>

                  {clientSortType !== "custom" && (
                    <button
                      type="button"
                      onClick={handleFixCurrentOrder}
                      disabled={isSavingOrder}
                      className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded-lg shadow-3xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Salvar esta ordenação atual como a nova ordem manual padrão do sistema"
                    >
                      {isSavingOrder ? "Salvando..." : "💾 Fixar Ordem"}
                    </button>
                  )}
                </div>
              </div>

              {successMsg && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 text-[10px] font-bold rounded-lg flex items-center gap-2 border border-emerald-250/30 animate-fade-in shadow-3xs">
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500" />
                  <span>{successMsg}</span>
                </div>
              )}

              {errorMsg && (
                <div className="p-2.5 bg-red-50 text-red-800 text-[10px] font-bold rounded-lg flex items-center gap-2 border border-red-200/30 animate-fade-in shadow-3xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {filteredClients.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
                  <Building className="w-8 h-8 text-slate-350 mx-auto mb-2" />
                  <h4 className="text-xs font-bold text-slate-700 font-sans">
                    Nenhum Registro Encontrado
                  </h4>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-0.5 leading-relaxed font-sans">
                    Não encontramos clientes que correspondam aos filtros de
                    pesquisa ativos.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredClients.map((client, index) => {
                    const clientScreens = screens.filter(
                      (s) => s.clientId === client.id,
                    );
                    const plan = plans.find((p) => p.id === client.planId);

                    // Format vencimento nicely
                    const formatVencimento = (v: string) => {
                      if (!v) return "Sem Vencimento";
                      const parts = v.split("-");
                      if (parts.length === 3) {
                        return `${parts[2]}/${parts[1]}/${parts[0]}`;
                      }
                      return v;
                    };

                    return (
                      <div
                        key={client.id}
                        draggable={clientSortType === "custom"}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "text/plain",
                            index.toString(),
                          );
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                        }}
                        onDrop={async (e) => {
                          const fromIndex = parseInt(
                            e.dataTransfer.getData("text/plain"),
                          );
                          const toIndex = index;
                          if (!isNaN(fromIndex) && fromIndex !== toIndex) {
                            await handleDragReorder(fromIndex, toIndex);
                          }
                        }}
                        className={`bg-white border rounded-xl overflow-hidden shadow-2xs transition hover:border-indigo-355 ${clientSortType === "custom" ? "border-indigo-250" : "border-slate-205"}`}
                      >
                        {/* Elegant Client Line Header - COMPACT */}
                        <div
                          style={{ backgroundColor: "#bbc6ec" }}
                          className="py-3 px-4 border-b border-slate-900/10 flex flex-col xl:flex-row xl:items-center justify-between gap-4 font-sans"
                        >
                          {/* Left Column: Client Details */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Row Reordering - drag icon replaces the arrows under custom sorting mode */}
                            {clientSortType === "custom" ? (
                              <div
                                className="flex items-center justify-center shrink-0 w-[24px] h-[34px] bg-white/80 border border-slate-350/50 rounded-lg text-slate-800 cursor-grab active:cursor-grabbing hover:bg-white transition shadow-3xs"
                                title="Clique e arraste este estabelecimento para reordenar livremente."
                              >
                                <GripVertical className="w-4 h-4 shrink-0 text-slate-600" />
                              </div>
                            ) : (
                              <div
                                className="flex items-center justify-center shrink-0 w-[24px] h-[34px] bg-white/80 border border-slate-350/30 rounded-lg text-slate-800 transition shadow-3xs"
                                title="Ative 'Ordem Personalizada (Manual)' no menu para mover e reordenar livremente por arrastar."
                              >
                                <span className="text-[10px] font-black font-mono">
                                  #{index + 1}
                                </span>
                              </div>
                            )}
                            <div className="p-2 bg-white/80 border border-slate-300 text-slate-800 rounded-lg shrink-0 shadow-3xs flex items-center justify-center">
                              <Building className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 space-y-1.5 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-xs font-black text-slate-900 leading-none">
                                  {client.establishmentName}
                                </h4>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingClient(client);
                                    setEditClientEstName(
                                      client.establishmentName || "",
                                    );
                                    setEditClientOwnerName(client.name || "");
                                    setEditClientPhone(client.phone || "");
                                    setEditClientCity(client.city || "");
                                    setEditClientState(client.state || "");
                                    setEditClientPlanId(client.planId || "");
                                    setEditClientVencimento(
                                      client.vencimento || "",
                                    );
                                    setIsEditClientModalOpen(true);
                                  }}
                                  className="p-1 bg-white/80 hover:bg-white text-slate-700 hover:text-indigo-900 rounded-md border border-slate-300/80 shadow-3xs transition cursor-pointer flex items-center justify-center"
                                  title="Editar Estabelecimento Comercial / Cliente"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                                <span className="text-[9.5px] font-bold text-slate-800 bg-white/80 border border-slate-300/40 px-2 py-0.5 rounded shadow-3xs">
                                  📍 {client.city} - {client.state}
                                </span>
                                <span className="text-[9.5px] font-bold text-indigo-900 bg-white/90 border border-indigo-200 px-2 py-0.5 rounded shadow-3xs">
                                  🛡️ Plano: {plan ? plan.name : "Nenhum"}
                                </span>
                                <span className="text-[9.5px] font-bold text-emerald-850 bg-white/95 border border-emerald-200 px-2 py-0.5 rounded shadow-3xs flex items-center gap-0.5">
                                  📺 TVs:{" "}
                                  <span className="font-extrabold text-emerald-950">
                                    {clientScreens.length}
                                  </span>
                                  /{plan ? plan.maxScreens : "0"}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-800 flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold leading-none">
                                <span>
                                  <strong>👤 Resp:</strong> {client.name}
                                </span>
                                {client.phone && (
                                  <a
                                    href={`https://wa.me/${client.phone.replace(/\D/g, "")}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-950 hover:underline font-bold flex items-center gap-0.5 px-1.5 py-0.2"
                                  >
                                    📞 {client.phone}
                                  </a>
                                )}
                                <span className="text-slate-900 font-mono font-bold bg-white/80 text-[9px] px-1.5 py-0.5 rounded border border-slate-300/40 shadow-3xs">
                                  📅 Vence:{" "}
                                  {formatVencimento(client.vencimento)}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Right Column: Actions Toolbar & Accordion Toggle */}
                          <div className="flex items-center gap-2 flex-wrap xl:justify-end shrink-0">
                            {confirmClientStandbyId === client.id ? (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 px-2.5 rounded-lg h-8 animate-fade-in text-[10px] font-bold text-amber-900 shadow-3xs"
                              >
                                <span>
                                  Ligar/Standby ({clientScreens.length} TV)?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleClientStandby(client.id, true);
                                    setConfirmClientStandbyId(null);
                                  }}
                                  className="h-6 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded font-extrabold uppercase text-[9px] cursor-pointer"
                                >
                                  Sim
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmClientStandbyId(null)
                                  }
                                  className="h-6 px-2 bg-slate-200 hover:bg-slate-350 text-slate-750 rounded font-bold uppercase text-[9px] cursor-pointer"
                                >
                                  Não
                                </button>
                              </div>
                            ) : confirmClientUnpairAllId === client.id ? (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 bg-red-50 border border-red-350 px-2.5 rounded-lg h-8 animate-fade-in text-[10px] font-bold text-red-900 shadow-3xs"
                              >
                                <span>
                                  Desvincular {clientScreens.length} TV(s)?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleClientUnpairAll(client.id, true);
                                    setConfirmClientUnpairAllId(null);
                                  }}
                                  className="h-6 px-2 bg-red-650 hover:bg-red-755 text-white rounded font-extrabold uppercase text-[9px] cursor-pointer"
                                >
                                  Sim
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmClientUnpairAllId(null)
                                  }
                                  className="h-6 px-2 bg-slate-200 hover:bg-slate-350 text-slate-755 rounded font-bold uppercase text-[9px] cursor-pointer"
                                >
                                  Não
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPairingClientId(client.id);
                                    setScreenNameInput(
                                      `Monitor - ${client.establishmentName}`,
                                    );
                                    setPairingMode("createDirect");
                                    setPairingOpen(true);
                                    window.scrollTo({
                                      top: 0,
                                      behavior: "smooth",
                                    });
                                  }}
                                  className="h-8 flex items-center justify-center px-2.5 bg-white border border-indigo-250 text-indigo-755 hover:bg-indigo-50 font-bold text-[9px] tracking-wide rounded-lg transition-all cursor-pointer shadow-3xs gap-0.5 shrink-0"
                                  title="Criar e Vincular Nova TV Diretamente para este Cliente (Sem Código e sem limites de plano)"
                                >
                                  ➕ NOVA TV DIRETO
                                </button>
                                
                                <button
                                  type="button"
                                  onClick={() => handleClientActive(client.id)}
                                  disabled={clientScreens.length === 0}
                                  className="h-8 flex items-center justify-center px-2.5 bg-emerald-555 hover:bg-emerald-600 border border-emerald-600 text-white disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-205 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-[9px] tracking-wide rounded-lg transition-all cursor-pointer shadow-3xs shrink-0"
                                  title="Ligar todas as TVs deste cliente"
                                >
                                  🚀 LIGAR TUDO
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmClientStandbyId(client.id);
                                    setConfirmClientUnpairAllId(null);
                                  }}
                                  disabled={clientScreens.length === 0}
                                  className="h-8 flex items-center justify-center px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-850 disabled:opacity-50 disabled:cursor-not-allowed border border-amber-300 font-bold text-[9px] tracking-wide rounded-lg transition-all cursor-pointer shadow-3xs shrink-0"
                                  title="Standby para todas as TVs"
                                >
                                  💤 STANDBY
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmClientUnpairAllId(client.id);
                                    setConfirmClientStandbyId(null);
                                  }}
                                  disabled={clientScreens.length === 0}
                                  className="h-8 flex items-center justify-center px-2.5 bg-red-50 hover:bg-red-100 text-red-755 disabled:opacity-50 disabled:cursor-not-allowed border border-red-350 font-bold text-[9px] tracking-wide rounded-lg transition-all cursor-pointer shadow-3xs shrink-0"
                                  title="Desvincular todas as TVs deste cliente"
                                >
                                  🚨 REMOVER
                                </button>
                              </>
                            )}

                            {/* Compress / Expand Button without arrow icons */}
                            <button
                              type="button"
                              onClick={() => toggleClientCollapse(client.id)}
                              className="h-8 flex items-center justify-center px-3 hover:bg-slate-150 text-slate-755 rounded-lg border border-slate-350 bg-white shadow-3xs transition cursor-pointer text-[10px] font-bold tracking-wide uppercase select-none shrink-0"
                              title={
                                collapsedClientIds[client.id]
                                  ? "Visualizar lista de TVs"
                                  : "Recolher lista de TVs"
                              }
                            >
                              {collapsedClientIds[client.id]
                                ? "Ver TVs"
                                : "Recolher"}
                            </button>
                          </div>
                        </div>

                        {/* List of TVs belonging to this client (Rows/Lines) */}
                        {!collapsedClientIds[client.id] && (
                          <div className="p-3 bg-slate-50/25 border-t border-slate-200/70">
                            {clientScreens.length === 0 ? (
                              <p className="text-[10.5px] text-slate-400 italic py-2 text-center font-sans">
                                Nenhuma Smart TV vinculada a este
                                estabelecimento.
                              </p>
                            ) : (
                              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1.5 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                                {clientScreens.map((scr) => {
                                  const isSelected =
                                    selectedScreenId === scr.id;
                                  const online = isScreenOnline(scr);

                                  return (
                                    <div
                                      key={scr.id}
                                      onClick={() =>
                                        setSelectedScreenId(scr.id)
                                      }
                                      className={`p-3 px-4 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all cursor-pointer ${
                                        isSelected
                                          ? "border-indigo-600 bg-indigo-50/10 shadow-sm ring-1 ring-indigo-500/25"
                                          : "border-slate-150 bg-white hover:border-slate-250 hover:bg-slate-50 shadow-3xs"
                                      }`}
                                    >
                                      {/* Column 1: TV Identifier (Icon + Name + Code) */}
                                      <div className="flex-1 flex flex-col md:flex-row md:items-center justify-start gap-4 md:gap-6 min-w-0">
                                        <div className="flex items-center gap-3 w-full md:w-52 shrink-0 min-w-0">
                                          <div
                                            className={`p-2 rounded-lg shrink-0 ${online ? "text-indigo-600 bg-indigo-100/50 border border-indigo-200/50" : "text-slate-400 bg-slate-100 border border-slate-200/40"}`}
                                          >
                                            <Tv className="w-4 h-4 shrink-0" />
                                          </div>
                                          <div className="min-w-0">
                                            <span className="text-xs font-bold text-slate-800 truncate block">
                                              {scr.name}
                                            </span>
                                            <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-650 border border-slate-200 px-1.5 py-0.2 rounded shrink-0 inline-block mt-0.5">
                                              CÓD: {scr.pairingCode}
                                            </span>
                                          </div>
                                        </div>

                                        {/* Column 2: Content Signal status badge */}
                                        <div className="flex items-center gap-1.5 min-w-0 md:w-56 shrink-0">
                                          <span
                                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? "bg-emerald-500 animate-pulse" : "bg-slate-350"}`}
                                          />
                                          <div className="min-w-0">
                                            <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider leading-none">
                                              Status de Sinal
                                            </span>
                                            <span className="text-xs font-semibold text-slate-700 truncate block mt-0.5">
                                              {scr.contentType === "idle" &&
                                                "Ocioso (Sem programação)"}
                                              {scr.contentType === "standby" &&
                                                "Standby / Descanso 💤"}
                                              {scr.contentType === "stopped" &&
                                                "Desligado / Sem Transmissão 🛑"}
                                              {scr.contentType === "asset" &&
                                                `Mídia: ${assets.find((a) => a.id === scr.contentId)?.name || "Carregando..."}`}
                                              {scr.contentType === "playlist" &&
                                                `Playlist: ${playlists.find((a) => a.id === scr.contentId)?.name || "Carregando..."}`}
                                            </span>
                                          </div>
                                        </div>

                                        {/* Column 3: Quick Links */}
                                        <div className="flex flex-col gap-1.5 select-none font-mono" onClick={(e) => e.stopPropagation()}>
                                          <div className="flex items-center gap-1.5 bg-indigo-50/70 border border-indigo-100 p-1.5 px-2.5 rounded-lg max-w-full lg:max-w-xs">
                                            <span className="text-[9px] text-indigo-800 font-bold shrink-0 uppercase tracking-widest">
                                              URL Silk:
                                            </span>
                                            <span 
                                              className="font-mono text-[9.5px] text-indigo-600 truncate select-all flex-1 font-semibold" 
                                              title={`${window.location.origin}${window.location.pathname}?mode=player&screenId=${scr.id}`}
                                            >
                                              {`${window.location.origin}${window.location.pathname}?mode=player&screenId=${scr.id}`}
                                            </span>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const url = `${window.location.origin}${window.location.pathname}?mode=player&screenId=${scr.id}`;
                                                try {
                                                  navigator.clipboard.writeText(url);
                                                  setCopiedUrl(url);
                                                  setTimeout(() => setCopiedUrl(null), 2000);
                                                } catch (err) {
                                                  console.warn("Clipboard blocked", err);
                                                }
                                              }}
                                              className="p-1 text-indigo-600 hover:text-indigo-850 hover:bg-indigo-100/80 rounded transition shrink-0 cursor-pointer"
                                              title="Copiar URL para o Amazon Silk Browser"
                                            >
                                              {copiedUrl === `${window.location.origin}${window.location.pathname}?mode=player&screenId=${scr.id}` ? (
                                                <Check className="w-3.5 h-3.5 text-emerald-600 font-bold" />
                                              ) : (
                                                <Copy className="w-3.5 h-3.5" />
                                              )}
                                            </button>
                                            <a
                                              href={`${window.location.origin}${window.location.pathname}?mode=player&screenId=${scr.id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="p-1 text-indigo-500 hover:text-indigo-800 hover:bg-indigo-100/80 rounded transition shrink-0"
                                              title="Abrir Player (Salvar nos Favoritos do Silk)"
                                            >
                                              <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Right Column: Controls & Interactions */}
                                      <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0 select-none w-full lg:w-auto">
                                        {/* Power toggle */}
                                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-150 px-2 py-0.5 rounded-lg h-8">
                                          <span
                                            className={`text-[8.5px] font-black tracking-wider uppercase ${scr.contentType !== "stopped" ? "text-emerald-600" : "text-slate-400"}`}
                                          >
                                            {scr.contentType !== "stopped"
                                              ? "ON"
                                              : "OFF"}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleTogglePower(
                                                scr.id,
                                                scr.contentType,
                                                scr.contentId,
                                              );
                                            }}
                                            className={`w-8 h-4.5 rounded-full p-0.5 transition-colors duration-250 cursor-pointer flex items-center ${
                                              scr.contentType !== "stopped"
                                                ? "bg-emerald-500"
                                                : "bg-slate-350"
                                            }`}
                                            title={
                                              scr.contentType !== "stopped"
                                                ? "Desligar Exibição"
                                                : "Ligar Exibição"
                                            }
                                          >
                                            <div
                                              className={`bg-white w-3.5 h-3.5 rounded-full shadow-xxs transform transition-transform duration-250 ${
                                                scr.contentType !== "stopped"
                                                  ? "translate-x-3.5"
                                                  : "translate-x-0"
                                              }`}
                                            />
                                          </button>
                                        </div>

                                        {/* Content drop selector */}
                                        <select
                                          value={`${scr.contentType}:${scr.contentId}`}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) => {
                                            const [cType, cId] =
                                              e.target.value.split(":");
                                            assignContentToScreen(
                                              scr.id,
                                              cType as any,
                                              cId,
                                            );
                                          }}
                                          className="px-2 py-1 bg-white border border-slate-205 text-slate-705 rounded-lg text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none cursor-pointer h-8 max-w-[140px] md:max-w-[160px]"
                                        >
                                          <option value="idle:">
                                            -- Selecionar --
                                          </option>
                                          <option value="standby:">
                                            Standby
                                          </option>
                                          <option value="stopped:">
                                            Desligado 🛑
                                          </option>
                                          <optgroup label="📋 Playlists">
                                            {playlists.map((p) => (
                                              <option
                                                key={p.id}
                                                value={`playlist:${p.id}`}
                                              >
                                                🔁 {p.name}
                                              </option>
                                            ))}
                                          </optgroup>
                                          <optgroup label="🎯 Mídias">
                                            {assets
                                              .filter(
                                                (a) =>
                                                  !a.clientId ||
                                                  a.clientId === scr.clientId,
                                              )
                                              .map((a) => (
                                                <option
                                                  key={a.id}
                                                  value={`asset:${a.id}`}
                                                >
                                                  📺 {a.name}
                                                </option>
                                              ))}
                                          </optgroup>
                                        </select>

                                        {/* Action pencil / delete buttons */}
                                        {confirmDeleteScreenId === scr.id ? (
                                          <div
                                            onClick={(e) => e.stopPropagation()}
                                            className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg p-1 h-8 animate-fade-in shrink-0"
                                          >
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleUnpairScreen(
                                                  scr.id,
                                                  true,
                                                );
                                                setConfirmDeleteScreenId(null);
                                              }}
                                              className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[9px] font-black uppercase transition cursor-pointer"
                                            >
                                              Sim
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setConfirmDeleteScreenId(null);
                                              }}
                                              className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-350 text-slate-750 rounded text-[9px] font-bold uppercase transition cursor-pointer"
                                            >
                                              Não
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-150 rounded-lg p-0.5 h-8">
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openEditScreenModal(scr);
                                              }}
                                              className="p-1 text-slate-400 hover:text-indigo-650 hover:bg-white rounded transition"
                                              title="Editar TV"
                                            >
                                              <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setConfirmDeleteScreenId(
                                                  scr.id,
                                                );
                                              }}
                                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-white rounded transition"
                                              title="Excluir TV"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live TV Monitor Simulator Pane (Right) - STICKY COMPANION LISTENER */}
        <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-6 space-y-4 shadow-sm bg-white border border-slate-200 rounded-xl p-5 z-20">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-800 flex items-center gap-1.5 font-sans">
                <Monitor className="w-4 h-4 text-indigo-500" />
                Simulador de TV Inteligente
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Acompanhe a reprodução e sintonize mídias em tempo real.
              </p>
            </div>
          </div>

          {selectedScreenId ? (
            (() => {
              const pairedScreen = screens.find(
                (s) => s.id === selectedScreenId,
              );
              if (!pairedScreen) return null;

              return (
                <div className="space-y-4">
                  {/* Outer Frame styled like a thin bezel premium TV display */}
                  <div className="w-full relative bg-slate-950 rounded-lg p-2 border border-slate-800 shadow-lg flex flex-col justify-between">
                    <div className="w-full aspect-video rounded bg-black overflow-hidden relative flex flex-col items-center justify-center border border-slate-900 shadow-inner">
                      {/* Active Scheduled Timer Overrides with Black Screen */}
                      {isScheduledOff(pairedScreen) && (
                        <div className="absolute inset-0 bg-slate-950 z-50 flex flex-col items-center justify-center text-center p-4 select-none animate-fade-in">
                          <Clock className="w-5 h-5 text-indigo-400 animate-pulse mb-1 shrink-0" />
                          <span className="text-[9px] uppercase font-extrabold text-indigo-400 tracking-wider font-mono">
                            Fora de Horário (Timer)
                          </span>
                          <span className="text-[8px] text-slate-500 font-medium max-w-[180px] leading-tight mt-0.5">
                            Visor exibe tela preta fora do expediente
                            pré-ajustado.
                          </span>
                        </div>
                      )}

                      {/* Interactive Player Renderer depending on active states */}
                      {pairedScreen.contentType === "standby" ? (
                        <div className="w-full h-full bg-[#05060c] flex flex-col items-center justify-center text-center p-4 select-none animate-fade-in">
                          <Tv className="w-5 h-5 text-amber-500 animate-pulse mb-1 shrink-0" />
                          <span className="text-[9px] uppercase font-bold text-amber-500 tracking-wider font-mono">
                            Standby Ativado
                          </span>
                          <span className="text-[8px] text-slate-500 font-medium leading-tight max-w-xs">
                            Smart TV em modo de descanso.
                          </span>
                        </div>
                      ) : pairedScreen.contentType === "stopped" ? (
                        <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center text-center p-4 select-none animate-fade-in">
                          {/* Color bars preview */}
                          <div className="flex w-24 h-6 border border-slate-900 rounded overflow-hidden opacity-30 mb-1 leading-none mx-auto">
                            <div className="flex-1 bg-white h-full" />
                            <div className="flex-1 bg-yellow-400 h-full" />
                            <div className="flex-1 bg-teal-400 h-full" />
                            <div className="flex-1 bg-emerald-400 h-full" />
                            <div className="flex-1 bg-rose-500 h-full" />
                            <div className="flex-1 bg-blue-600 h-full" />
                          </div>
                          <span className="text-[9px] uppercase font-bold text-rose-500 tracking-wider font-mono leading-none mt-1">
                            Exibição Parada
                          </span>
                          <span className="text-[8px] text-slate-505 mt-0.5">
                            Exibição desligada via painel remoto.
                          </span>
                        </div>
                      ) : !simulatedAsset ? (
                        <div className="p-4 w-full h-full flex flex-col items-center justify-center bg-slate-900 border border-slate-800/80 text-center select-none space-y-1">
                          <Tv className="w-5 h-5 text-indigo-455 animate-pulse mb-1" />
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                            TV OCIOSA
                          </span>
                          <span className="text-[8.5px] text-slate-500 max-w-xs leading-normal">
                            Escolha uma mídia ou playlist para sintonizar este
                            painel.
                          </span>
                        </div>
                      ) : (
                        <div className="w-full h-full relative flex flex-col justify-center overflow-hidden">
                          {simulatedAsset.type === "text" && (
                            <div
                              className="w-full h-full flex flex-col justify-center p-4"
                              style={{
                                backgroundColor:
                                  simulatedAsset.config?.backgroundColor ||
                                  "#0f172a",
                                color:
                                  simulatedAsset.config?.textColor || "#ffffff",
                              }}
                            >
                              <div
                                className="text-[9.5px] font-bold leading-normal whitespace-pre-line"
                                style={{
                                  textAlign:
                                    simulatedAsset.config?.textAlign ||
                                    "center",
                                  fontFamily:
                                    simulatedAsset.config?.fontFamily === "sans"
                                      ? "sans-serif"
                                      : simulatedAsset.config?.fontFamily ===
                                          "mono"
                                        ? "monospace"
                                        : "serif",
                                }}
                              >
                                {simulatedAsset.content}
                              </div>
                            </div>
                          )}

                          {simulatedAsset.type === "image" && (
                            <img
                              src={simulatedAsset.url}
                              alt=""
                              className="w-full h-full object-cover animate-fade-in"
                              referrerPolicy="no-referrer"
                            />
                          )}

                          {simulatedAsset.type === "video" && (
                            <video
                              src={simulatedAsset.url}
                              muted
                              loop
                              autoPlay
                              className="w-full h-full object-cover"
                            />
                          )}

                          {simulatedAsset.type === "web" && (
                            <iframe
                              src={simulatedAsset.url}
                              title="tv-sim-web"
                              className="w-full h-full border-0 pointer-events-none scale-90"
                            />
                          )}

                          {/* OSD Ticker Overlay for playlists */}
                          {pairedScreen.contentType === "playlist" && (
                            <div className="absolute top-2 left-2 bg-slate-900/85 backdrop-blur-xs py-0.5 px-1.5 rounded text-[8px] font-bold text-white tracking-wider uppercase border border-white/5">
                              PLAYLIST • {playlistIndex + 1}/
                              {
                                playlists.find(
                                  (p) => p.id === pairedScreen.contentId,
                                )?.items.length
                              }
                            </div>
                          )}
                        </div>
                      )}

                      {/* Display watermarks */}
                      <div className="absolute bottom-1.5 right-1.5 bg-slate-950/70 p-1 rounded border border-white/5 text-[6.5px] text-slate-400 pointer-events-none uppercase tracking-widest font-mono font-bold">
                        VITRION LIVE PREVIEW
                      </div>
                    </div>

                    {/* Plastic Bezel stand foot at bottom */}
                    <div className="w-10 h-1.5 bg-slate-800 mx-auto mt-1 rounded-sm border-b border-slate-900" />
                    <div className="w-14 h-0.5 bg-slate-900 mx-auto rounded-sm shrink-0" />
                  </div>

                  {/* Sidebar Interactive Controls for selected screen */}
                  <div className="bg-slate-50/70 border border-slate-205 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 font-sans flex items-center gap-1">
                        <Monitor className="w-3.5 h-3.5 text-indigo-500" />
                        Ações Rápidas: {pairedScreen.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${pairedScreen.contentType !== "stopped" ? "bg-emerald-50 text-emerald-705 border border-emerald-100" : "bg-slate-100 text-slate-600 border border-slate-200"}`}
                      >
                        {pairedScreen.contentType !== "stopped"
                          ? "Ativo"
                          : "Inativo"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {/* Power Switch Button */}
                      <button
                        type="button"
                        onClick={() =>
                          handleTogglePower(
                            pairedScreen.id,
                            pairedScreen.contentType,
                            pairedScreen.contentId,
                          )
                        }
                        className={`py-1.5 px-2.5 rounded-lg text-[11px] font-bold font-sans transition flex items-center justify-center gap-1 border cursor-pointer select-none ${
                          pairedScreen.contentType !== "stopped"
                            ? "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100/50"
                            : "bg-emerald-55 bg-indigo-600 text-white border-transparent hover:bg-indigo-700"
                        }`}
                        title={
                          pairedScreen.contentType !== "stopped"
                            ? "Suspender transmissão"
                            : "Ligar transmissão"
                        }
                      >
                        <Power className="w-3.5 h-3.5" />
                        {pairedScreen.contentType !== "stopped"
                          ? "Desligar"
                          : "Ligar"}
                      </button>

                      {/* Standby Moon Button */}
                      <button
                        type="button"
                        onClick={() =>
                          assignContentToScreen(pairedScreen.id, "standby", "")
                        }
                        disabled={pairedScreen.contentType === "stopped"}
                        className="py-1.5 px-2.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-[11px] font-bold text-amber-800 transition flex items-center justify-center gap-1 cursor-pointer"
                        title="Tela de descanso em modo standby"
                      >
                        💤 Standby
                      </button>
                    </div>

                    {/* Quick Channel Content Sintonizer */}
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Sintonizar Playlist/Mídia
                      </label>
                      <select
                        value={`${pairedScreen.contentType}:${pairedScreen.contentId}`}
                        disabled={pairedScreen.contentType === "stopped"}
                        onChange={(e) => {
                          const [cType, cId] = e.target.value.split(":");
                          assignContentToScreen(
                            pairedScreen.id,
                            cType as any,
                            cId,
                          );
                        }}
                        className="w-full px-3 py-1.5 bg-white disabled:bg-slate-100 disabled:text-slate-400 border border-slate-200 rounded-lg text-xs font-bold leading-tight outline-none focus:ring-1 focus:ring-indigo-500 transition cursor-pointer"
                      >
                        <option value="idle:">-- Pausar Programação --</option>
                        <option value="standby:">
                          Standby (Exibir Marca/Logo)
                        </option>
                        <optgroup label="📋 Playlists do Sistema">
                          {playlists.map((p) => (
                            <option key={p.id} value={`playlist:${p.id}`}>
                              🔁 {p.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="🎯 Biblioteca de Mídias">
                          {assets
                            .filter(
                              (a) =>
                                !a.clientId ||
                                !pairedScreen.clientId ||
                                a.clientId === pairedScreen.clientId,
                            )
                            .map((a) => (
                              <option key={a.id} value={`asset:${a.id}`}>
                                📺 {a.name}
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    </div>

                    {/* Quick Specs summary */}
                    <div className="bg-white border border-slate-150 p-3 rounded-lg text-[9.5px] text-slate-500 font-mono space-y-1.5 leading-none">
                      <div className="flex justify-between items-center">
                        <span className="font-bold">CANAIS ATIVOS:</span>
                        <span className="font-extrabold text-slate-800 uppercase bg-slate-100 border border-slate-200 px-1 py-0.2 rounded">
                          {pairedScreen.contentType}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-bold">
                          CÓDIGO DE TRANSMISSÃO:
                        </span>
                        <span className="font-bold text-indigo-750 bg-indigo-50 border border-indigo-100 px-1 py-0.2 rounded">
                          {pairedScreen.pairingCode}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-0.5">
                        <span className="font-bold">STATUS DO SINAL:</span>
                        {isScreenOnline(pairedScreen) ? (
                          <span className="text-[9px] font-bold text-emerald-600 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block" />{" "}
                            ONLINE
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-slate-300 rounded-full inline-block" />{" "}
                            OFFLINE
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="text-center py-12 bg-slate-50 border border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 gap-1.5">
              <Monitor className="w-8 h-8 opacity-40 shrink-0 text-slate-500" />
              <span className="text-[11px] font-bold text-slate-500 leading-none uppercase tracking-wide">
                Nenhum Monitor Ativo
              </span>
              <span className="text-[9.5px] text-slate-400 max-w-[210px] mx-auto leading-normal">
                Selecione uma Smart TV na lista de clientes ao lado para
                carregar sua exibição e liberar ações diretas.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Screen Editor Modal Panel Dialog */}
      {isEditModalOpen && editingScreen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-up select-none">
            <header className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-150 flex items-center justify-center text-indigo-600">
                  <Tv className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Definições do Monitor ({editingScreen.pairingCode})
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Configure o apelido do painel ou vincule a um cliente.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingScreen(null);
                }}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </header>

            <form onSubmit={handleSaveScreenDetails} className="p-6 space-y-4">
              {/* Apelido do Painel */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Nome de Identificação / Apelido *
                </label>
                <input
                  type="text"
                  required
                  value={editScreenName}
                  onChange={(e) => setEditScreenName(e.target.value)}
                  placeholder="Ex: Painel Lanchonete"
                  className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition"
                />
              </div>

              {/* Cliente Associado */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Cliente / Estabelecimento Proprietário
                </label>
                <select
                  value={editScreenClientId}
                  onChange={(e) => setEditScreenClientId(e.target.value)}
                  className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition leading-normal"
                >
                  <option value="">-- Vincular a Nenhum (Geral) --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      🏢 {c.establishmentName} ({c.city} - {c.state})
                    </option>
                  ))}
                </select>
                <p className="text-[9px] text-slate-400 leading-normal pt-1">
                  Vincular o monitor a um cliente permite que você rastreie e
                  localize este display facilmente no projeto.
                </p>
              </div>

              {/* Weekly Schedule configuration in Admin Modal */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-500" />
                  Programador de Horários (Timer Semanal)
                </label>
                <p className="text-[9px] text-slate-400 leading-normal">
                  Configure os horários de início e término de exibição para
                  cada dia da semana. Fora deste intervalo, o visor exibirá tela
                  preta.
                </p>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {[
                    { key: "monday", label: "Segunda-feira" },
                    { key: "tuesday", label: "Terça-feira" },
                    { key: "wednesday", label: "Quarta-feira" },
                    { key: "thursday", label: "Quinta-feira" },
                    { key: "friday", label: "Sexta-feira" },
                    { key: "saturday", label: "Sábado" },
                    { key: "sunday", label: "Domingo" },
                  ].map(({ key, label }) => {
                    const dayConfig = editScreenSchedule[key] || {
                      enabled: false,
                      startTime: "08:00",
                      endTime: "18:00",
                    };
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 p-1.5 bg-slate-50 border border-slate-100 rounded text-slate-700"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            id={`admin-sched-${key}`}
                            checked={dayConfig.enabled}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setEditScreenSchedule((prev) => ({
                                ...prev,
                                [key]: { ...dayConfig, enabled: checked },
                              }));
                            }}
                            className="rounded border-slate-200 text-indigo-650 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                          />
                          <label
                            htmlFor={`admin-sched-${key}`}
                            className="font-semibold text-[10.5px] select-none cursor-pointer"
                          >
                            {label}
                          </label>
                        </div>

                        {dayConfig.enabled ? (
                          <div className="flex items-center gap-1 text-[10px]">
                            <span className="text-slate-450 text-[9px]">
                              Das:
                            </span>
                            <input
                              type="time"
                              value={dayConfig.startTime}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditScreenSchedule((prev) => ({
                                  ...prev,
                                  [key]: { ...dayConfig, startTime: val },
                                }));
                              }}
                              className="bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-800 outline-none focus:border-indigo-500 text-[10px] font-bold"
                            />
                            <span className="text-slate-450 text-[9px]">
                              Até:
                            </span>
                            <input
                              type="time"
                              value={dayConfig.endTime}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditScreenSchedule((prev) => ({
                                  ...prev,
                                  [key]: { ...dayConfig, endTime: val },
                                }));
                              }}
                              className="bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-800 outline-none focus:border-indigo-500 text-[10px] font-bold"
                            />
                          </div>
                        ) : (
                          <span className="text-[9.5px] italic text-slate-400">
                            Ativo o dia todo
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Unique stats and timeline details */}
              <div className="bg-slate-50 border border-slate-150 p-3 rounded-lg text-[9.5px] text-slate-500 font-mono space-y-1">
                <div>
                  <strong>CÓDIGO EXCLUSIVO:</strong>{" "}
                  <span className="text-slate-800 font-bold bg-slate-200 px-1 rounded">
                    {editingScreen.pairingCode}
                  </span>
                </div>
                <div>
                  <strong>SINTONIZADO EM:</strong>{" "}
                  {formatFullDateTime(
                    editingScreen.pairedAt || editingScreen.createdAt,
                  )}
                </div>
                {editingScreen.lastActive && (
                  <div>
                    <strong>SINAL ATIVO (PULSO):</strong>{" "}
                    {formatFullDateTime(editingScreen.lastActive)}
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end border-t border-slate-100 pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingScreen(null);
                  }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition shadow-xs hover:shadow-sm"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Client Quick Editor Modal Panel Dialog */}
      {isEditClientModalOpen && editingClient && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          {/* ... edit client contents are retained ... */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-up select-none">
            <header className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-150 flex items-center justify-center text-indigo-600">
                  <Building className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Editar Estabelecimento
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Atualize os dados e plano contratado do cliente.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditClientModalOpen(false);
                  setEditingClient(null);
                }}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </header>

            <form onSubmit={handleSaveClientDetails} className="p-6 space-y-4">
              {/* Nome do Estabelecimento */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Nome do Estabelecimento *
                </label>
                <input
                  type="text"
                  required
                  value={editClientEstName}
                  onChange={(e) => setEditClientEstName(e.target.value)}
                  className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition"
                />
              </div>

              {/* Nome do Responsável */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Nome do Responsável *
                </label>
                <input
                  type="text"
                  required
                  value={editClientOwnerName}
                  onChange={(e) => setEditClientOwnerName(e.target.value)}
                  className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition"
                />
              </div>

              {/* Telefone Responsável */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Telefone Comercial *
                </label>
                <input
                  type="text"
                  required
                  value={editClientPhone}
                  onChange={(e) => setEditClientPhone(e.target.value)}
                  className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Cidade */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Cidade *
                  </label>
                  <input
                    type="text"
                    required
                    value={editClientCity}
                    onChange={(e) => setEditClientCity(e.target.value)}
                    className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition"
                  />
                </div>
                {/* Estado */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Estado (UF) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={editClientState}
                    onChange={(e) => setEditClientState(e.target.value)}
                    className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Plano */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Plano Comercial *
                  </label>
                  <select
                    value={editClientPlanId}
                    onChange={(e) => setEditClientPlanId(e.target.value)}
                    className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-[11px] text-slate-700 outline-none transition"
                  >
                    <option value="">-- Sem Plano --</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Max: {p.maxScreens})
                      </option>
                    ))}
                  </select>
                </div>
                {/* Vencimento */}
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Vencimento *
                  </label>
                  <input
                    type="date"
                    required
                    value={editClientVencimento}
                    onChange={(e) => setEditClientVencimento(e.target.value)}
                    className="w-full bg-white border border-slate-250 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none transition"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end border-t border-slate-100 pt-4 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditClientModalOpen(false);
                    setEditingClient(null);
                  }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold cursor-pointer transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold cursor-pointer transition shadow-xs hover:shadow-sm"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Real-time Smart TV Simulator Modal Dialog */}
      
    </div>
  );
}
