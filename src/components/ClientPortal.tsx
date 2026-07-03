import React, { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { VitrionLogo } from "./VitrionLogo";
// @ts-ignore
import vitrionLogoOficial from "../assets/images/vitrion_logo_oficial.png";
import { Client, Screen, Asset, Playlist, PlaylistItem } from "../types";
import {
  Tv,
  Layers,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MapPin,
  Check,
  Play,
  X,
  Sliders,
  Info,
  ShoppingBag,
  ListPlus,
  ArrowUp,
  ArrowDown,
  FolderHeart,
  Save,
  Sparkles,
  Film,
  Monitor,
  Loader2,
  Power,
  ChevronDown,
  ChevronUp,
  Clock,
  Settings,
  Pencil,
} from "lucide-react";

// Error monitoring based on firebase-integration skill
enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

function handleLocalFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path,
  };
  console.error("Firestore Error in Client Portal: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Generates a random uppercase pairing code (4 characters)
function generateDisplayCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No confusing chars like I, O, 0, 1
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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

function isScheduledOff(screenDoc: any): boolean {
  if (!screenDoc) return false;

  const { dayIndex, timeStr: currentTimeStr } = getBrasiliaTimeParts();

  // A schedule is considered valid/active if at least one day is enabled
  const hasActiveSchedule = screenDoc.schedule && Object.values(screenDoc.schedule).some((day: any) => day?.enabled === true);

  if (hasActiveSchedule) {
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

  // 2. Default weekly schedule fallback:
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

function hasActiveAdmin(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      !!localStorage.getItem("vitrion_active_admin")
    );
  } catch (e) {
    return false;
  }
}

interface ClientPortalProps {
  client: Client;
  onLogout: () => void;
  onClientUpdate?: (updatedClient: Client) => void;
}

export default function ClientPortal({
  client,
  onLogout,
  onClientUpdate,
}: ClientPortalProps) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  const [loadingScreens, setLoadingScreens] = useState(true);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadingPlaylists, setLoadingPlaylists] = useState(true);

  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [activeTab, setActiveTab] = useState<
    "screens" | "assets" | "playlists"
  >("screens");

  // Client configuration and update states
  const [isEditClientOpen, setIsEditClientOpen] = useState(false);
  const [editEstName, setEditEstName] = useState(
    client.establishmentName || "",
  );
  const [editPhone, setEditPhone] = useState(client.phone || "");
  const [editWhatsApp, setEditWhatsApp] = useState(client.whatsapp || "");
  const [editUsername, setEditUsername] = useState(client.username || "");
  const [editPassword, setEditPassword] = useState(client.password || "");
  const [editEmail, setEditEmail] = useState(client.email || "");
  const [editAddress, setEditAddress] = useState(client.address || "");
  const [editCity, setEditCity] = useState(client.city || "");
  const [editState, setEditState] = useState(client.state || "");
  const [editCEP, setEditCEP] = useState(client.cep || "");
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

  // New Display Form States
  const [newDisplayName, setNewDisplayName] = useState("");
  const [isAddScreenOpen, setIsAddScreenOpen] = useState(false);
  const [addDisplayTab, setAddDisplayTab] = useState<"quick" | "generate">(
    "quick",
  );
  const [quickPairCode, setQuickPairCode] = useState("");
  const [quickDisplayName, setQuickDisplayName] = useState("");
  const [isSubmittingQuickPair, setIsSubmittingQuickPair] = useState(false);

  // Edit Screen Name States
  const [editingScreenNameId, setEditingScreenNameId] = useState<string | null>(null);
  const [editingScreenNameValue, setEditingScreenNameValue] = useState("");
  const [isSavingScreenName, setIsSavingScreenName] = useState(false);

  // New Playlist Form States
  const [isAddPlaylistOpen, setIsAddPlaylistOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [playlistName, setPlaylistName] = useState("");
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [playlistSchedule, setPlaylistSchedule] = useState<Record<string, any>>(
    {},
  );
  const [isPlaylistScheduleOpen, setIsPlaylistScheduleOpen] = useState(false);

  // New Product Form States
  const [newProductName, setNewProductName] = useState("");
  const [newProductUrl, setNewProductUrl] = useState("");
  const [isAddAssetOpen, setIsAddAssetOpen] = useState(false);
  const [uploadMethod, setUploadMethod] = useState<"url" | "file">("url");
  const [fileBase64, setFileBase64] = useState<string>("");
  const [fileType, setFileType] = useState<"image" | "video">("image");

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);



  // Weekly Timing Schedule state variables
  const [expandedSchedules, setExpandedSchedules] = useState<
    Record<string, boolean>
  >({});
  const [localSchedules, setLocalSchedules] = useState<Record<string, any>>({});
  const [savingSchedule, setSavingSchedule] = useState<string | null>(null);

  const DAYS_OF_WEEK = [
    { key: "monday", label: "Segunda-feira" },
    { key: "tuesday", label: "Terça-feira" },
    { key: "wednesday", label: "Quarta-feira" },
    { key: "thursday", label: "Quinta-feira" },
    { key: "friday", label: "Sexta-feira" },
    { key: "saturday", label: "Sábado" },
    { key: "sunday", label: "Domingo" },
  ];

  const createDefaultSchedule = () => {
    const sched: any = {};
    [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ].forEach((day) => {
      sched[day] = {
        enabled: false,
        startTime: "08:00",
        endTime: "18:00",
      };
    });
    return sched;
  };

  const toggleScheduleSection = (screen: Screen) => {
    const current = !!expandedSchedules[screen.id];
    setExpandedSchedules((prev) => ({ ...prev, [screen.id]: !current }));

    if (!current && !localSchedules[screen.id]) {
      const existing = screen.schedule || {};
      const defaultSched = createDefaultSchedule();
      const merged = { ...defaultSched };
      Object.keys(existing).forEach((day) => {
        merged[day] = {
          enabled: existing[day].enabled ?? false,
          startTime: existing[day].startTime || "08:00",
          endTime: existing[day].endTime || "18:00",
        };
      });
      setLocalSchedules((prev) => ({ ...prev, [screen.id]: merged }));
    }
  };

  const handleSaveScreenSchedule = async (screenId: string, schedule: any) => {
    setSavingSchedule(screenId);
    try {
      const docRef = doc(db, "screens", screenId);
      await updateDoc(docRef, {
        schedule: schedule,
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg("Programação de horários atualizada com sucesso!");
    } catch (err) {
      console.error("Error saving screen schedule:", err);
      handleLocalFirestoreError(
        err,
        OperationType.UPDATE,
        `screens/${screenId}`,
      );
    } finally {
      setSavingSchedule(null);
    }
  };

  const handleSaveScreenName = async (screenId: string) => {
    if (!editingScreenNameValue.trim()) {
      setErrorMsg("O nome do display não pode ser vazio.");
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }
    setIsSavingScreenName(true);
    try {
      const docRef = doc(db, "screens", screenId);
      await updateDoc(docRef, {
        name: editingScreenNameValue.trim(),
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg("Nome do display atualizado com sucesso!");
      setEditingScreenNameId(null);
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch (err) {
      console.error("Error saving screen name:", err);
      handleLocalFirestoreError(
        err,
        OperationType.UPDATE,
        `screens/${screenId}`,
      );
    } finally {
      setIsSavingScreenName(false);
    }
  };

  // Live client and plan subscription states
  const [currentClient, setCurrentClient] = useState<Client>(client);
  const [clientPlan, setClientPlan] = useState<any>(null);

  // Subscribe to live client account adjustments
  useEffect(() => {
    const docRef = doc(db, "clients", client.id);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setCurrentClient({ id: docSnap.id, ...docSnap.data() } as Client);
        }
      },
      (err) => {
        console.error("Error syncing client details in Portal:", err);
      },
    );
    return () => unsubscribe();
  }, [client.id]);

  // Subscribe to live contracted pricing plans and limits
  useEffect(() => {
    if (!currentClient.planId) {
      setClientPlan(null);
      return;
    }
    const planRef = doc(db, "plans", currentClient.planId);
    const unsubscribe = onSnapshot(
      planRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setClientPlan({ id: docSnap.id, ...docSnap.data() });
        }
      },
      (err) => {
        console.error("Error syncing plan limits in Portal:", err);
      },
    );
    return () => unsubscribe();
  }, [currentClient.planId]);

  // Sync edit profile form inputs when modal is opened or currentClient is synced
  useEffect(() => {
    if (isEditClientOpen) {
      setEditEstName(currentClient.establishmentName || "");
      setEditPhone(currentClient.phone || "");
      setEditWhatsApp(currentClient.whatsapp || "");
      setEditUsername(currentClient.username || "");
      setEditPassword(currentClient.password || "");
      setEditEmail(currentClient.email || "");
      setEditAddress(currentClient.address || "");
      setEditCity(currentClient.city || "");
      setEditState(currentClient.state || "");
      setEditCEP(currentClient.cep || "");
    }
  }, [isEditClientOpen, currentClient]);

  // Handle client profile self-update
  const handleSaveClientProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEstName.trim()) {
      setErrorMsg("O nome do estabelecimento é obrigatório.");
      return;
    }
    if (!editUsername.trim()) {
      setErrorMsg("O nome do usuário é obrigatório.");
      return;
    }
    if (!editPassword.trim()) {
      setErrorMsg("A senha do estabelecimento é obrigatória.");
      return;
    }

    setIsSavingClient(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const docRef = doc(db, "clients", currentClient.id);

      // Look up if user username exists and belongs to someone else to prevent duplication
      const q = query(
        collection(db, "clients"),
        where("username", "==", editUsername.trim()),
      );
      const querySnap = await getDocs(q);
      let duplicate = false;
      querySnap.forEach((docSnap) => {
        if (docSnap.id !== currentClient.id) {
          duplicate = true;
        }
      });

      if (duplicate) {
        setErrorMsg(
          "Este nome de usuário já está sendo utilizado por outro estabelecimento.",
        );
        setIsSavingClient(false);
        return;
      }

      const updatedFields = {
        establishmentName: editEstName.trim(),
        phone: editPhone.trim(),
        whatsapp: editWhatsApp.trim(),
        username: editUsername.trim(),
        password: editPassword.trim(),
        email: editEmail.trim(),
        address: editAddress.trim(),
        city: editCity.trim(),
        state: editState.trim(),
        cep: editCEP.trim(),
        updatedAt: serverTimestamp(),
      };

      await updateDoc(docRef, updatedFields);

      // Create updated client object (keep original fields like ownerId, createdAt, vencimento, etc.)
      const updatedClient: Client = {
        ...currentClient,
        ...updatedFields,
      };

      // update local storage
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "vitrion_logged_client",
          JSON.stringify(updatedClient),
        );
      }

      // invoke prop callback if set
      if (onClientUpdate) {
        onClientUpdate(updatedClient);
      }

      setSuccessMsg(
        "As informações do cadastro foram atualizadas com sucesso!",
      );
      setIsEditClientOpen(false);

      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err: any) {
      console.error("Erro ao atualizar cadastro do cliente:", err);
      setErrorMsg("Erro ao atualizar informações: " + err.message);
      handleLocalFirestoreError(
        err,
        OperationType.UPDATE,
        `clients/${currentClient.id}`,
      );
    } finally {
      setIsSavingClient(false);
    }
  };

  // Listener for Client's Screens
  useEffect(() => {
    const q = query(
      collection(db, "screens"),
      where("clientId", "==", client.id),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const scList: Screen[] = [];
        snapshot.forEach((docSnap) => {
          scList.push({ id: docSnap.id, ...docSnap.data() } as Screen);
        });
        // Sort screens alphabetically
        scList.sort((a, b) => a.name.localeCompare(b.name));
        setScreens(scList);
        setLoadingScreens(false);
      },
      (err) => {
        setLoadingScreens(false);
        console.error("Error fetching screens: ", err);
      },
    );

    return () => unsubscribe();
  }, [client.id]);

  // Listener for Client's Assets (Products)
  useEffect(() => {
    const q = query(
      collection(db, "assets"),
      where("clientId", "==", client.id),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const asList: Asset[] = [];
        snapshot.forEach((docSnap) => {
          asList.push({ id: docSnap.id, ...docSnap.data() } as Asset);
        });
        setAssets(asList);
        setLoadingAssets(false);
      },
      (err) => {
        setLoadingAssets(false);
        console.error("Error fetching assets: ", err);
      },
    );

    return () => unsubscribe();
  }, [client.id]);

  // Listener for Client's Playlists
  useEffect(() => {
    const q = query(
      collection(db, "playlists"),
      where("clientId", "==", client.id),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const plList: Playlist[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          plList.push({
            id: docSnap.id,
            name: d.name || "",
            items: d.items || [],
            ownerId: d.ownerId || "",
            clientId: d.clientId || "",
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          });
        });
        setPlaylists(plList);
        setLoadingPlaylists(false);
      },
      (err) => {
        setLoadingPlaylists(false);
        console.error("Error fetching playlists: ", err);
        handleLocalFirestoreError(err, OperationType.LIST, "playlists");
      },
    );

    return () => unsubscribe();
  }, [client.id]);

  // Copy Code Helper
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  // Add a brand new screen/display
  const handleAddDisplay = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!newDisplayName.trim()) {
      setErrorMsg("Por favor, informe um nome descritivo para o display.");
      return;
    }

    // Capacity restriction based on plan limit
    const maxScreens = clientPlan ? clientPlan.maxScreens : 1;
    if (screens.length >= maxScreens) {
      setErrorMsg(
        `Limite de displays atingido! O seu plano contratado permite no máximo ${maxScreens} ${maxScreens === 1 ? "TV" : "TVs"}. Entre em contato com a administração para realizar o reajuste.`,
      );
      return;
    }

    try {
      // Step 1: Generate a unique 4-character uppercase code
      let isCodeUnique = false;
      let generatedCode = "";
      let attempts = 0;

      while (!isCodeUnique && attempts < 10) {
        generatedCode = generateDisplayCode();
        attempts++;

        // Assert uniqueness
        const screenSnap = await getDocs(
          query(collection(db, "screens"), where("id", "==", generatedCode)),
        );
        if (screenSnap.empty) {
          isCodeUnique = true;
        }
      }

      if (!generatedCode) {
        setErrorMsg(
          "Erro gerando código único para a Smart TV. Tente novamente.",
        );
        return;
      }

      // Step 2: Create matching document directly in Firestore
      const screenRef = doc(db, "screens", generatedCode);
      const payload: Screen = {
        id: generatedCode,
        name: newDisplayName.trim(),
        pairingCode: generatedCode,
        status: "online", // Mock online on setup for immediate feedback
        lastActive: serverTimestamp(),
        contentType: "idle",
        contentId: "",
        pairedAt: serverTimestamp(),
        ownerId: client.ownerId, // Set to admin owner ID
        clientId: client.id, // Linked to current client
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(screenRef, payload);

      setSuccessMsg(
        `Display "${newDisplayName.trim()}" registrado com sucesso! Código Gerado: ${generatedCode}`,
      );
      setNewDisplayName("");
      setIsAddScreenOpen(false);

      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err) {
      console.error(err);
      setErrorMsg(
        "Falha ao adicionar novo display. Erro de permissão do Firestore.",
      );
    }
  };

  // Sintonizar Smart TV de forma rápida pelo código gerado na TV
  const handleQuickPairTV = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const code = quickPairCode.trim().toUpperCase();
    if (code.length !== 4) {
      setErrorMsg(
        "O código de pareamento deve conter exatamente 4 caracteres.",
      );
      return;
    }

    if (!quickDisplayName.trim()) {
      setErrorMsg("Por favor, defina um nome amigável para este monitor.");
      return;
    }

    // Capacity restriction based on plan limit
    const maxScreens = clientPlan ? clientPlan.maxScreens : 1;
    if (screens.length >= maxScreens) {
      setErrorMsg(
        `Limite de displays atingido! O seu plano contratado permite no máximo ${maxScreens} ${maxScreens === 1 ? "TV" : "TVs"}. Remova uma das TVs existentes ou peça aumento de cota.`,
      );
      return;
    }

    setIsSubmittingQuickPair(true);

    try {
      const screenRef = doc(db, "screens", code);
      const screenSnap = await getDocs(
        query(collection(db, "screens"), where("id", "==", code)),
      );

      if (screenSnap.empty) {
        setErrorMsg(
          "Estação de TV não encontrada! Verifique o código exibido no seu monitor ou tente recarregar o TV Player.",
        );
        setIsSubmittingQuickPair(false);
        return;
      }

      await updateDoc(screenRef, {
        name: quickDisplayName.trim(),
        ownerId: currentClient.ownerId || "vitrion-sandbox-admin",
        clientId: currentClient.id,
        pairedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "online",
      });

      setSuccessMsg(
        `Excelente! O monitor "${quickDisplayName.trim()}" foi sincronizado com sucesso!`,
      );
      setQuickPairCode("");
      setQuickDisplayName("");
      setIsAddScreenOpen(false);

      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err: any) {
      console.error("Erro ao sintonizar via Conexão Rápida:", err);
      setErrorMsg(
        "Falha ao sincronizar o monitor com o Firestore: " + err.message,
      );
    } finally {
      setIsSubmittingQuickPair(false);
    }
  };

  // Remove screen/display
  const handleRemoveDisplay = async (screenId: string, screenName: string) => {
    setErrorMsg("");
    setSuccessMsg("");

    try {
      // Directly delete the screen document from Firestore
      await deleteDoc(doc(db, "screens", screenId));
      setSuccessMsg(`Display "${screenName}" foi removido com sucesso.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Falha ao remover o display.");
    }
  };

  ;

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
      console.error("Error assigning content:", err);
      setErrorMsg("Falha ao sintonizar conteúdo.");
    }
  };

  const handleTogglePower = async (
    screenId: string,
    currentType: "playlist" | "asset" | "idle" | "standby" | "stopped",
    contentId: string,
  ) => {
    try {
      if (currentType === "stopped") {
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

  // Assign product asset to screen contentId (Vincular Produto)
  const handleAssignProduct = async (screenId: string, assetId: string) => {
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await updateDoc(doc(db, "screens", screenId), {
        contentType: "asset",
        contentId: assetId,
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg("Produto vinculado ao monitor com sucesso!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao vincular mídia ao display.");
    }
  };

  // Assign Playlist to screen (Vincular Playlist)
  const handleAssignPlaylist = async (screenId: string, playlistId: string) => {
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await updateDoc(doc(db, "screens", screenId), {
        contentType: "playlist",
        contentId: playlistId,
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg("Playlist de exibição vinculada ao monitor com sucesso!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao vincular playlist de exibição ao display.");
    }
  };

  // Add asset to currently building/editing playlist
  const handleAddAssetToPlaylist = (asset: Asset) => {
    const newItem: PlaylistItem = {
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      url: asset.url,
      content: asset.content || "",
      config: asset.config || {},
      duration: 10, // Default duration in seconds
    };
    setPlaylistItems((prev) => [...prev, newItem]);
    setSuccessMsg(`"${asset.name}" adicionado à playlist.`);
    setTimeout(() => setSuccessMsg(""), 1500);
  };

  // Remove item from editing playlist
  const handleRemoveItemFromPlaylist = (index: number) => {
    setPlaylistItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Move playlist item up in sequence order
  const handleMovePlaylistItemUp = (index: number) => {
    if (index === 0) return;
    setPlaylistItems((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[index - 1];
      copy[index - 1] = temp;
      return copy;
    });
  };

  // Move playlist item down in sequence order
  const handleMovePlaylistItemDown = (index: number) => {
    setPlaylistItems((prev) => {
      if (index === prev.length - 1) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[index + 1];
      copy[index + 1] = temp;
      return copy;
    });
  };

  // Change duration of playlist item
  const handlePlaylistDurationChange = (index: number, duration: number) => {
    setPlaylistItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], duration: Math.max(1, duration) };
      return copy;
    });
  };

  const initializePlaylistSchedule = (playlist?: Playlist) => {
    const existing = playlist?.schedule || {};
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
    setPlaylistSchedule(defaultSched);
    setIsPlaylistScheduleOpen(false);
  };

  // Save new or edited playlist
  const handleSavePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!playlistName.trim()) {
      setErrorMsg("Por favor, informe o nome da playlist.");
      return;
    }

    if (playlistItems.length === 0) {
      setErrorMsg("A playlist deve conter pelo menos uma imagem / vídeo.");
      return;
    }

    try {
      if (editingPlaylist) {
        // Update existing playlist
        await updateDoc(doc(db, "playlists", editingPlaylist.id), {
          name: playlistName.trim(),
          items: playlistItems,
          schedule: playlistSchedule,
          updatedAt: serverTimestamp(),
        });
        setSuccessMsg(
          `Playlist de exibição "${playlistName}" editada com sucesso!`,
        );
      } else {
        // Create new playlist
        const plRef = doc(collection(db, "playlists"));
        await setDoc(plRef, {
          name: playlistName.trim(),
          items: playlistItems,
          ownerId: client.ownerId, // Linked to owner/administrator
          clientId: client.id, // Linked to this specific client account
          schedule: playlistSchedule,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setSuccessMsg(`Nova playlist de exibição "${playlistName}" criada.`);
      }

      // Reset Form State
      setPlaylistName("");
      setPlaylistItems([]);
      setEditingPlaylist(null);
      initializePlaylistSchedule();
      setIsAddPlaylistOpen(false);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao salvar a playlist no banco de dados.");
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

  // Delete playlist document
  const handleDeletePlaylist = async (playlistId: string, name: string) => {
    if (!safeConfirm(`Deseja realmente excluir a playlist "${name}"?`)) {
      return;
    }

    setErrorMsg("");
    setSuccessMsg("");

    try {
      // If any screen is displaying this playlist, reset it to idle
      const batch = writeBatch(db);
      const affectedScreens = screens.filter(
        (s) => s.contentType === "playlist" && s.contentId === playlistId,
      );

      affectedScreens.forEach((sc) => {
        batch.update(doc(db, "screens", sc.id), {
          contentType: "idle",
          contentId: "",
          updatedAt: serverTimestamp(),
        });
      });

      batch.delete(doc(db, "playlists", playlistId));
      await batch.commit();

      setSuccessMsg(`Playlist "${name}" excluída com sucesso.`);

      // If currently editing this playlist, reset form
      if (editingPlaylist?.id === playlistId) {
        setEditingPlaylist(null);
        setPlaylistName("");
        setPlaylistItems([]);
        initializePlaylistSchedule();
        setIsAddPlaylistOpen(false);
      }
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao excluir playlist do banco de dados.");
    }
  };

  // Pop up edit state for specified playlist
  const handleStartEditPlaylist = (playlist: Playlist) => {
    setActiveTab("playlists");
    setEditingPlaylist(playlist);
    setPlaylistName(playlist.name);
    setPlaylistItems(playlist.items);
    initializePlaylistSchedule(playlist);
    setIsAddPlaylistOpen(true);

    // Smooth scroll to playlist config area
    const configArea = document.getElementById("playlist-management-section");
    if (configArea) {
      configArea.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Reset screen content back to idle (Remover do Display / Parar Exibição)
  const handleResetDisplayContent = async (screenId: string) => {
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await updateDoc(doc(db, "screens", screenId), {
        contentType: "idle",
        contentId: "",
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg("Monitores voltaram para a tela ociosa.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao remover conteúdo do display.");
    }
  };

  // Set screen content to standby mode (Standby / Espera)
  const handleSetStandbyMode = async (screenId: string) => {
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await updateDoc(doc(db, "screens", screenId), {
        contentType: "standby",
        contentId: "",
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg("Display colocado em Standby (Modo de Espera).");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao colocar display em Standby.");
    }
  };

  // Stop display transmission (Stop)
  const handleStopTransmission = async (screenId: string) => {
    setErrorMsg("");
    setSuccessMsg("");
    try {
      await updateDoc(doc(db, "screens", screenId), {
        contentType: "stopped",
        contentId: "",
        updatedAt: serverTimestamp(),
      });
      setSuccessMsg("Transmissão parada com sucesso.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Erro ao parar transmissão do display.");
    }
  };

  // Handle Computer file upload and convert to base64 for local database persistence and live sync
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg("");
    const file = e.target.files?.[0];
    if (!file) return;

    // Warning / Restriction on Firestore document limit (about 1MB)
    const MAX_SIZE = 850 * 1024; // ~850KB
    if (file.size > MAX_SIZE) {
      setErrorMsg(
        "Arquivo muito grande! Para salvar imagens/vídeos no banco, o limite de arquivos sincronizados é de 800KB. Reduza as dimensões da imagem ou utilize o método por URL.",
      );
      e.target.value = "";
      return;
    }

    const typeOfFile = file.type.startsWith("video/") ? "video" : "image";
    setFileType(typeOfFile);

    const reader = new FileReader();
    reader.onload = () => {
      const base64String = reader.result as string;
      setFileBase64(base64String);
      setNewProductUrl(base64String); // Set url state to preview and write to Firestore
    };
    reader.onerror = () => {
      setErrorMsg("Erro ao ler o arquivo local do computador.");
    };
    reader.readAsDataURL(file);
  };

  // Add Product Asset to client library
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!newProductName.trim()) {
      setErrorMsg("Por favor, informe o nome do produto.");
      return;
    }

    const isLocalFile = newProductUrl.startsWith("data:");
    if (
      !newProductUrl.trim() ||
      (!newProductUrl.startsWith("http") && !isLocalFile)
    ) {
      setErrorMsg(
        "Insira uma URL de mídia válida ou envie um arquivo do computador.",
      );
      return;
    }

    const assetId = `prod_${Date.now()}`;
    const assetPayload = {
      id: assetId,
      name: newProductName.trim(),
      type: fileType, // Dynamic 'image' or 'video'
      url: newProductUrl.trim(),
      content: "", // Custom text is optional
      ownerId: client.ownerId,
      clientId: client.id,
      duration: 10,
      config: {
        backgroundColor: "#0f172a",
        textColor: "#ffffff",
        fontSize: "md",
        fontFamily: "sans",
        textAlign: "center",
        scrollSpeed: "none",
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, "assets", assetId), assetPayload);
      setSuccessMsg(
        `Produto "${newProductName.trim()}" cadastrado com sucesso!`,
      );
      setNewProductName("");
      setNewProductUrl("");
      setFileBase64("");
      setFileType("image");
      setUploadMethod("url");
      setIsAddAssetOpen(false);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao registrar produto.");
    }
  };

  // Remove product asset
  const handleRemoveProduct = async (assetId: string, assetName: string) => {
    if (!safeConfirm(`Excluir imagem do produto "${assetName}"?`)) {
      return;
    }

    setErrorMsg("");
    setSuccessMsg("");

    try {
      // Step 1: Delete product asset document
      await deleteDoc(doc(db, "assets", assetId));

      // Step 2: Unlink from any active screens displaying this asset
      const affectedScreens = screens.filter(
        (s) => s.contentType === "asset" && s.contentId === assetId,
      );

      const batch = writeBatch(db);
      affectedScreens.forEach((sc) => {
        batch.update(doc(db, "screens", sc.id), {
          contentType: "idle",
          contentId: "",
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();

      setSuccessMsg(`Produto "${assetName}" e vínculos limpos com sucesso.`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Falha ao remover produto.");
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-900 font-sans text-slate-300 overflow-y-auto pb-16">
      {/* Active Impersonation Bar */}
      {hasActiveAdmin() && (
        <div className="bg-gradient-to-r from-amber-600 to-amber-700 text-white px-6 py-2.5 text-xs flex items-center justify-between shadow-inner select-none font-medium border-b border-amber-850">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-200"></span>
            </span>
            <span className="font-mono uppercase font-bold tracking-wider bg-amber-800 px-1.5 py-0.5 rounded text-[9px]">
              Controle Admin
            </span>
            <span>
              Você está controlando os <strong>Monitores & TVs</strong>,{" "}
              <strong>Biblioteca de Mídias</strong> e{" "}
              <strong>Playlist de Loop</strong> de{" "}
              <strong className="underline">{client.establishmentName}</strong>.
            </span>
          </div>
          <button
            onClick={onLogout}
            className="px-3 py-1 bg-white hover:bg-slate-50 text-amber-950 font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5 hover:scale-103 text-[10px] shadow-sm uppercase shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair do Controle
          </button>
        </div>
      )}

      {/* Top Banner Branding Header */}
      <div className="p-6 md:p-8 bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-900 border-b border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2">
            <VitrionLogo variant="badge" theme="dark" size="xs" />
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            {client.establishmentName}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-indigo-400" />
              {client.city} - {client.state}
            </span>
            <span className="text-slate-600">&bull;</span>
            <span>Usuário: {client.username}</span>
            <span className="text-slate-600">&bull;</span>
            <span>E-mail: {client.email}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 items-end shrink-0">
          <div className="flex flex-wrap items-center gap-3 justify-end">
            <button
              type="button"
              onClick={() => setIsEditClientOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-650 hover:bg-indigo-600 text-white border border-indigo-500/30 rounded-xl text-xs font-semibold transition duration-300 cursor-pointer shadow-sm"
            >
              <Settings className="w-4 h-4 text-white animate-spin-hover" />
              Configurar Cadastro
            </button>

            <button
              onClick={onLogout}
              className={`flex items-center gap-1.5 px-4 py-2 border rounded-xl text-xs font-semibold transition duration-300 cursor-pointer ${
                hasActiveAdmin()
                  ? "bg-amber-900/40 hover:bg-amber-900/60 border-amber-800/80 text-amber-200 hover:text-white"
                  : "bg-slate-800/80 hover:bg-slate-800 hover:text-white border border-slate-700/60 text-slate-300"
              }`}
            >
              <LogOut className="w-4 h-4 text-red-400" />
              {hasActiveAdmin() ? "Sair do Controle" : "Desconectar do Portal"}
            </button>
          </div>


        </div>
      </div>

      <div className="p-6 md:p-8 space-y-8">
        {/* Status Alerts Feedback */}
        {errorMsg && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl text-xs flex items-center gap-2.5 animate-fade-in shadow-md">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 rounded-xl text-xs flex items-center gap-2.5 animate-fade-in shadow-md">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Real-time Plan Check Bento Box */}
        <div
          id="portal-plan-bento"
          className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-950/40 p-5 md:p-6 rounded-2xl border border-slate-800/85"
        >
          <div className="space-y-1.5">
            <span className="text-[9px] uppercase font-mono tracking-widest text-indigo-400 font-bold block">
              Assinatura Atual
            </span>
            <p className="text-sm font-bold text-white">
              {clientPlan ? clientPlan.name : "Plano Comercial"}
            </p>
            <p className="text-[11px] text-slate-400 leading-tight">
              Seu plano com limite estipulado em displays independentes.
            </p>
          </div>

          <div className="space-y-1.5 border-t md:border-t-0 md:border-x border-slate-800 px-0 md:px-6 py-3 md:py-0">
            <span className="text-[9px] uppercase font-mono tracking-widest text-indigo-400 font-bold block">
              Uso da Cota
            </span>
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-slate-150 font-mono shrink-0">
                {screens.length} de {clientPlan ? clientPlan.maxScreens : "1"}{" "}
                ativos
              </p>
              <div className="flex-1 bg-slate-800/60 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (screens.length / (clientPlan ? clientPlan.maxScreens : 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              {screens.length >= (clientPlan ? clientPlan.maxScreens : 1)
                ? "⚠️ Deseja adicionar mais displays? Contate o gerente."
                : "Você pode parear mais dispositivos."}
            </p>
          </div>

          <div className="space-y-1.5 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
            <span className="text-[9px] uppercase font-mono tracking-widest text-indigo-400 font-bold block">
              Valor do Plano
            </span>
            <p className="text-sm font-extrabold text-emerald-400 font-mono">
              {clientPlan?.price !== undefined && clientPlan?.price !== null
                ? `R$ ${clientPlan.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês`
                : "Valor em Aberto"}
            </p>
            <p className="text-[11px] text-slate-450 leading-tight">
              A mensalidade é faturada mensalmente de acordo com o plano
              contratado.
            </p>
          </div>
        </div>

        {/* Reorganized Segmented Workspace Tab Bar */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-850 gap-1 overflow-x-auto shrink-0 select-none">
          <button
            type="button"
            onClick={() => setActiveTab("screens")}
            className={`flex-1 min-w-[130px] md:min-w-0 py-2.5 text-center text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === "screens"
                ? "bg-indigo-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            <Tv className="w-4 h-4" />
            Monitores & TVs ({screens.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("assets")}
            className={`flex-1 min-w-[130px] md:min-w-0 py-2.5 text-center text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === "assets"
                ? "bg-indigo-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            Biblioteca de Mídias ({assets.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("playlists")}
            className={`flex-1 min-w-[130px] md:min-w-0 py-2.5 text-center text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === "playlists"
                ? "bg-indigo-600 text-white shadow-md"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            <Layers className="w-4 h-4" />
            Playlists de Loop ({playlists.length})
          </button>
        </div>

        {/* Dashboard Grid split into Two Main Sections */}
        <div
          className={`grid grid-cols-1 gap-8 ${activeTab === "playlists" ? "hidden" : "block"}`}
        >
          {/* COLUMN 1: Displays / Screens (LGs-7/12) */}
          <div
            className={`space-y-6 ${activeTab === "screens" ? "block" : "hidden"}`}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="block text-xs uppercase font-mono tracking-wider text-indigo-400 font-bold">
                  Seção 01
                </span>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Tv className="w-5 h-5 text-indigo-400" />
                  Monitores & Smart TVs ({screens.length} de{" "}
                  {clientPlan ? clientPlan.maxScreens : "1"})
                </h2>
              </div>

              <button
                onClick={() => setIsAddScreenOpen(!isAddScreenOpen)}
                id="btn-portal-add-display"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition duration-300 cursor-pointer hover:shadow-lg"
              >
                <Plus className="w-4 h-4" />
                Adicionar Display
              </button>
            </div>

            {/* Quick Add Display Form inline dropdown */}
            {isAddScreenOpen && (
              <div className="p-5 bg-slate-950 border border-slate-850 rounded-xl space-y-4 animate-slide-up">
                {/* Internal Tab Selector */}
                <div className="flex bg-slate-900 p-1 rounded-lg border border-white/5 gap-1 select-none">
                  <button
                    type="button"
                    onClick={() => setAddDisplayTab("quick")}
                    className={`flex-1 py-1.5 text-center text-[10.5px] font-bold rounded-md transition duration-205 cursor-pointer flex items-center justify-center gap-1.5 ${
                      addDisplayTab === "quick"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-450 hover:text-slate-200"
                    }`}
                  >
                    <Tv className="w-3.5 h-3.5" />
                    Conexão Rápida (Parear TV)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddDisplayTab("generate")}
                    className={`flex-1 py-1.5 text-center text-[10.5px] font-bold rounded-md transition duration-205 cursor-pointer flex items-center justify-center gap-1.5 ${
                      addDisplayTab === "generate"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-450 hover:text-slate-200"
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Gerar Novo Código
                  </button>
                </div>

                {addDisplayTab === "quick" ? (
                  /* TAB 1: QUICK PAIR TV BY CODE */
                  <form onSubmit={handleQuickPairTV} className="space-y-4">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 mb-1">
                        Sintonizar TV Instantaneamente
                      </h3>
                      <p className="text-[11.5px] text-slate-400 leading-relaxed">
                        Sua Smart TV está exibindo o código de pareamento de 4
                        letras? Digite o código e defina um nome abaixo para
                        ativá-la nesta conta em milissegundos.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-450 uppercase tracking-wider block">
                          Código de 4 Letras (ex: ABCD)
                        </label>
                        <input
                          type="text"
                          required
                          value={quickPairCode}
                          onChange={(e) => {
                            const val = e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9]/g, "");
                            setQuickPairCode(val.slice(0, 4));
                          }}
                          placeholder="DIGITE"
                          className="w-full bg-slate-900 border border-slate-800 text-cyan-400 text-center text-sm font-black tracking-widest px-3 py-2.5 rounded-lg focus:outline-hidden focus:border-cyan-500 uppercase font-mono"
                          maxLength={4}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-455 uppercase tracking-wider block">
                          Nome do Monitor
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Ex: TV Recepção, Vitrina"
                          value={quickDisplayName}
                          onChange={(e) => setQuickDisplayName(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 text-white text-xs px-3.5 py-2.5 rounded-lg focus:outline-hidden focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingQuickPair}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg shadow-md transition duration-200 cursor-pointer"
                    >
                      {isSubmittingQuickPair ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-white" />
                          <span>Conectando via Nuvem...</span>
                        </>
                      ) : (
                        <>
                          <Monitor className="w-4 h-4" />
                          <span>Sintonizar & Conectar Smart TV</span>
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  /* TAB 2: GENERATE NEW CODE (PREVIOUS FUNCTIONALITY) */
                  <form onSubmit={handleAddDisplay} className="space-y-4">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 mb-1">
                        Registrar Nova TV
                      </h3>
                      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                        Ao cadastrar o monitor, o portal gerará o{" "}
                        <strong>código de 4 dígitos</strong> correspondente.
                        Escreva o nome do local onde a TV ficará exposta:
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        placeholder="Ex: TV do Caixa, Menu Board Direita"
                        value={newDisplayName}
                        onChange={(e) => setNewDisplayName(e.target.value)}
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-800 text-white text-xs px-3.5 py-2.5 rounded-lg focus:outline-hidden focus:border-indigo-500"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shrink-0 cursor-pointer"
                      >
                        Gerar Código
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Display list view */}
            {loadingScreens ? (
              <div className="p-8 text-center bg-slate-950/40 border border-slate-800/50 rounded-xl space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                <p className="text-[11px] text-slate-500 uppercase tracking-widest font-mono">
                  Listando canais de TV...
                </p>
              </div>
            ) : screens.length === 0 ? (
              <div className="p-10 text-center bg-slate-950/40 border border-white/5 border-dashed rounded-xl space-y-3">
                <Tv className="w-10 h-10 text-slate-700 mx-auto" />
                <div>
                  <h4 className="text-sm font-bold text-slate-400">
                    Nenhum display ativado
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 leading-relaxed">
                    Você ainda não adicionou nenhuma Smart TV. Clique no botão
                    de "Adicionar Display" acima para receber seu código
                    exclusivo de parecimento.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
                {screens.map((screen) => {
                  const showingAsset = assets.find(
                    (a) => a.id === screen.contentId,
                  );
                  const showingPlaylist = playlists.find(
                    (p) => p.id === screen.contentId,
                  );

                  return (
                    <div
                      key={screen.id}
                      className="p-5 bg-slate-950/80 border border-slate-800/80 hover:border-slate-800 rounded-xl flex flex-col gap-4 relative overflow-hidden group shadow-md"
                    >
                      {/* Left accent column indicating screen status */}
                      <div
                        className={`absolute left-0 top-0 bottom-0 w-1 ${screen.status === "online" ? "bg-emerald-500" : "bg-slate-600"}`}
                      />

                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 pl-1">
                          {editingScreenNameId === screen.id ? (
                            <div className="flex items-center gap-1.5 animate-fade-in">
                              <input
                                type="text"
                                value={editingScreenNameValue}
                                onChange={(e) => setEditingScreenNameValue(e.target.value)}
                                className="bg-slate-900 border border-slate-750 focus:border-indigo-500 rounded px-2 py-0.5 text-xs text-white outline-none transition"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleSaveScreenName(screen.id);
                                  } else if (e.key === "Escape") {
                                    setEditingScreenNameId(null);
                                  }
                                }}
                              />
                              <button
                                onClick={() => handleSaveScreenName(screen.id)}
                                disabled={isSavingScreenName}
                                className="p-1 text-emerald-400 hover:text-emerald-300 transition cursor-pointer"
                                title="Salvar nome"
                              >
                                {isSavingScreenName ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                onClick={() => setEditingScreenNameId(null)}
                                className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                                title="Cancelar"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                              <span>{screen.name}</span>
                              <button
                                onClick={() => {
                                  setEditingScreenNameId(screen.id);
                                  setEditingScreenNameValue(screen.name);
                                }}
                                className="p-1 text-slate-500 hover:text-white transition cursor-pointer"
                                title="Editar nome do display"
                              >
                                <Pencil className="w-3 h-3 opacity-60 hover:opacity-100" />
                              </button>
                              <span className="relative flex h-2 w-2 shrink-0">
                                <span
                                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${screen.status === "online" ? "bg-emerald-400" : "bg-slate-500"}`}
                                ></span>
                                <span
                                  className={`relative inline-flex rounded-full h-2 w-2 ${screen.status === "online" ? "bg-emerald-500" : "bg-slate-500"}`}
                                ></span>
                              </span>
                              {isScheduledOff(screen) && (
                                <span className="inline-flex items-center gap-1.5 text-[9px] font-extrabold bg-amber-500/10 border border-amber-500/25 text-amber-400 px-2 py-0.5 rounded-full select-none ml-1 animate-pulse">
                                  <Clock className="w-2.5 h-2.5 text-amber-500" />
                                  TIMER ATIVO (TELA PRETA)
                                </span>
                              )}
                            </h3>
                          )}

                          <div className="flex flex-col gap-1.5 mt-1">
                            <div className="flex items-center gap-1 text-[11px] text-slate-400">
                              <span>Código de Pareamento: </span>
                              <span className="font-mono font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded text-xs select-all">
                                {screen.pairingCode}
                              </span>
                              <button
                                onClick={() => handleCopyCode(screen.pairingCode)}
                                className="p-1 hover:text-white text-slate-500 transition ml-0.5 cursor-pointer"
                                title="Copiar Código"
                              >
                                {copiedCode === screen.pairingCode ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>

                            {/* Direct URL block for Amazon Silk or general bookmarking */}
                            <div className="flex items-center gap-1.5 bg-slate-900/60 p-2 rounded-lg border border-slate-800/80 max-w-sm">
                              <span className="text-[10px] text-slate-400 font-bold shrink-0 uppercase tracking-wider font-mono">
                                URL Silk:
                              </span>
                              <span 
                                className="font-mono text-[10px] text-indigo-300 truncate select-all flex-1" 
                                title={`${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`}
                              >
                                {`${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`}
                              </span>
                              <button
                                onClick={() => {
                                  const url = `${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`;
                                  try {
                                    navigator.clipboard.writeText(url);
                                    setCopiedCode(url);
                                    setTimeout(() => setCopiedCode(null), 2000);
                                  } catch (err) {
                                    console.warn("Navegador bloqueou escrita no clipboard.", err);
                                  }
                                }}
                                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition shrink-0 cursor-pointer"
                                title="Copiar URL para o Amazon Silk Browser"
                              >
                                {copiedCode === `${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <a
                                href={`${window.location.origin}${window.location.pathname}?mode=player&screenId=${screen.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 text-indigo-400 hover:text-indigo-300 hover:bg-slate-850 rounded transition shrink-0"
                                title="Abrir Player em tela cheia"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        </div>

                        {/* Remove monitor buttons */}
                        {confirmDeleteId === screen.id ? (
                          <div className="flex items-center gap-1.5 shrink-0 select-none animate-fade-in">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveDisplay(screen.id, screen.name);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-[10px] font-extrabold uppercase transition cursor-pointer border border-red-500 shadow-sm"
                            >
                              Confirmar?
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-md text-[10px] font-bold uppercase transition cursor-pointer border border-slate-650"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(screen.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg bg-white/2 hover:bg-white/5 opacity-85 hover:opacity-100 transition shrink-0 cursor-pointer"
                            title="Excluir e desvincular este display de TV permanentemente"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {/* Real-time Simulator Aspect-Video TV Display Frame */}
                      <div className="space-y-1.5 pl-1">
                        <span className="text-[10px] text-slate-450 font-bold uppercase tracking-wider block">
                          📺 Monitor de Preview (Smart TV em Tempo Real):
                        </span>
                        <div className="w-full aspect-video rounded-xl bg-slate-950 border border-slate-850 overflow-hidden shadow-inner relative flex items-center justify-center p-0.5">
                          <div className="absolute top-2 left-2.5 z-10 bg-indigo-600/90 text-[7px] text-white font-bold px-1.5 py-0.5 rounded uppercase tracking-widest border border-indigo-400/20">
                            PREVIEW ATIVO
                          </div>

                          {screen.contentType === "standby" ? (
                            <div className="w-full h-full bg-[#020B18] relative flex items-center justify-center p-2">
                              <img
                                src={vitrionLogoOficial}
                                className="max-h-full max-w-full object-contain opacity-20"
                                alt=""
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
                                <Tv className="w-4 h-4 text-amber-500 animate-pulse mb-0.5 shrink-0" />
                                <span className="text-[8px] uppercase font-bold text-amber-400 tracking-wider font-mono">
                                  Standby
                                </span>
                              </div>
                            </div>
                          ) : screen.contentType === "stopped" ? (
                            <div className="w-full h-full bg-[#020B18] relative flex items-center justify-center p-2">
                              <img
                                src={vitrionLogoOficial}
                                className="max-h-full max-w-full object-contain opacity-20"
                                alt=""
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
                                <Tv className="w-4 h-4 text-rose-500 animate-pulse mb-0.5 shrink-0" />
                                <span className="text-[8px] uppercase font-bold text-rose-400 tracking-wider font-mono">
                                  Parado (Stopped)
                                </span>
                              </div>
                            </div>
                          ) : screen.contentType === "playlist" &&
                            showingPlaylist ? (
                            <div className="w-full h-full bg-[#080710] flex flex-col items-center justify-center text-center p-3 relative">
                              {showingPlaylist.items?.[0]?.url ? (
                                <>
                                  {showingPlaylist.items[0].type === "video" ? (
                                    <video
                                      src={showingPlaylist.items[0].url}
                                      autoPlay
                                      loop
                                      muted
                                      playsInline
                                      className="absolute inset-0 w-full h-full object-cover opacity-25"
                                    />
                                  ) : (
                                    <img
                                      src={showingPlaylist.items[0].url}
                                      alt=""
                                      className="absolute inset-0 w-full h-full object-cover opacity-25"
                                      referrerPolicy="no-referrer"
                                    />
                                  )}
                                </>
                              ) : null}
                              <div className="relative z-10 space-y-1 bg-slate-950/80 p-2 rounded-lg border border-slate-800/40">
                                <Layers className="w-4 h-4 text-indigo-400 mx-auto animate-pulse" />
                                <span className="text-[9px] font-bold text-indigo-300 uppercase tracking-wider block font-mono leading-none">
                                  {showingPlaylist.name}
                                </span>
                                <p className="text-[8px] text-slate-400 leading-tight">
                                  Loop de {showingPlaylist.items?.length || 0}{" "}
                                  mídias
                                </p>
                              </div>
                            </div>
                          ) : screen.contentType === "asset" && showingAsset ? (
                            showingAsset.type === "video" ? (
                              <video
                                src={showingAsset.url}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                              />
                            ) : showingAsset.type === "image" ? (
                              <img
                                src={showingAsset.url}
                                alt=""
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : showingAsset.type === "text" ? (
                              <div
                                className="w-full h-full p-4 flex items-center justify-center text-center text-[9px] font-bold overflow-hidden"
                                style={{
                                  backgroundColor:
                                    showingAsset.config?.backgroundColor ||
                                    "#0f172a",
                                  color:
                                    showingAsset.config?.textColor || "#ffffff",
                                  fontFamily:
                                    showingAsset.config?.fontFamily === "sans"
                                      ? "sans-serif"
                                      : showingAsset.config?.fontFamily ===
                                          "mono"
                                        ? "monospace"
                                        : "serif",
                                }}
                              >
                                {showingAsset.content}
                              </div>
                            ) : (
                              <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center p-4">
                                <span className="text-[9px] text-slate-400">
                                  Suporte de Mídia
                                </span>
                              </div>
                            )
                          ) : (
                            // Idle state
                            <div className="w-full h-full bg-[#020B18] relative flex items-center justify-center p-2">
                              <img
                                src={vitrionLogoOficial}
                                className="max-h-full max-w-full object-contain opacity-20"
                                alt=""
                                referrerPolicy="no-referrer"
                              />
                              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
                                <Tv className="w-4 h-4 text-indigo-400 animate-pulse mb-0.5 shrink-0" />
                                <span className="text-[8px] uppercase font-bold text-indigo-300 tracking-wider font-mono">
                                  Monitor Ocioso
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Display active transmission status */}
                      <div className="bg-slate-900/60 rounded-xl p-3.5 border border-slate-850 flex flex-col gap-3.5 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-slate-450 truncate">
                            <ImageIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            {screen.contentType === "asset" && showingAsset ? (
                              <div className="truncate text-[11px]">
                                <span className="text-slate-550">
                                  Exibindo:{" "}
                                </span>
                                <strong className="text-slate-300 font-bold">
                                  {showingAsset.name}
                                </strong>
                              </div>
                            ) : screen.contentType === "playlist" &&
                              showingPlaylist ? (
                              <div className="truncate text-[11px] flex items-center gap-1.5">
                                <span className="text-indigo-400 font-mono text-[10px] font-bold border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 rounded leading-none">
                                  LOOP
                                </span>
                                <span
                                  className="text-slate-300 font-bold truncate max-w-[150px]"
                                  title={showingPlaylist.name}
                                >
                                  {showingPlaylist.name}
                                </span>
                              </div>
                            ) : screen.contentType === "standby" ? (
                              <span className="text-[11px] text-amber-500 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                                Smart TV suspensa (Standby)
                              </span>
                            ) : screen.contentType === "stopped" ? (
                              <span className="text-[11px] text-rose-450 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full" />
                                Transmissão Parada (Stopped)
                              </span>
                            ) : (
                              <span className="italic text-slate-500 text-[11px]">
                                Livre / Canal Ocioso (Pronta)
                              </span>
                            )}
                          </div>

                          {(screen.contentType === "asset" ||
                            screen.contentType === "playlist") && (
                            <button
                              onClick={() =>
                                handleResetDisplayContent(screen.id)
                              }
                              className="text-[10px] font-bold text-red-405 cursor-pointer hover:text-red-300 flex items-center gap-0.5 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded transition whitespace-nowrap"
                            >
                              <X className="w-3 h-3" />
                              Parar Exibição
                            </button>
                          )}
                        </div>

                        {/* Interactive TV Remote Controls (Standby, Stop, Remove in 1 Click) */}
                        <div className="border-t border-slate-850 pt-2.5 flex flex-wrap items-center justify-between gap-2.5">
                          <span className="text-[9px] text-indigo-400/80 font-bold uppercase tracking-wider">
                            🕹️ Controle de Energia e Sinal:
                          </span>

                          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-850 items-center">
                            {/* Standby */}
                            <button
                              type="button"
                              onClick={() => handleSetStandbyMode(screen.id)}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-md flex items-center gap-1 transition ${
                                screen.contentType === "standby"
                                  ? "bg-amber-600 font-bold text-white shadow-sm"
                                  : "text-slate-500 hover:text-slate-200"
                              }`}
                              title="Silenciar e suspender tela (modo standby)"
                            >
                              <span className="w-1 h-1 rounded-full bg-amber-400" />
                              Standby
                            </button>

                            <div className="w-px h-3 bg-slate-850 mx-1" />

                            {/* Stop */}
                            <button
                              type="button"
                              onClick={() => handleStopTransmission(screen.id)}
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-md flex items-center gap-1 transition ${
                                screen.contentType === "stopped"
                                  ? "bg-rose-600 font-bold text-white shadow-sm"
                                  : "text-slate-500 hover:text-slate-200"
                              }`}
                              title="Parar transmissão ativa de mídia"
                            >
                              <span className="w-1 h-1 rounded-full bg-rose-400" />
                              Stop
                            </button>

                            <div className="w-px h-3 bg-slate-850 mx-1" />

                            {/* Remove (Idle) */}
                            <button
                              type="button"
                              onClick={() =>
                                handleResetDisplayContent(screen.id)
                              }
                              className={`px-2.5 py-1 text-[10px] font-bold rounded-md flex items-center gap-1 transition ${
                                screen.contentType === "idle"
                                  ? "bg-indigo-600 font-bold text-white shadow-sm"
                                  : "text-slate-500 hover:text-slate-200"
                              }`}
                              title="Limpar sintonia e voltar para a tela padrão de pareamento"
                            >
                              Reset (Idle)
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Video Products selector area */}
                      {assets.length > 0 && (
                        <div className="border-t border-slate-900 pt-3 flex flex-col gap-2">
                          <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                            Transmitir Produto:
                          </span>

                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                            {assets.map((asset) => {
                              const isActive =
                                screen.contentType === "asset" &&
                                screen.contentId === asset.id;

                              return (
                                <button
                                  key={asset.id}
                                  onClick={() =>
                                    handleAssignProduct(screen.id, asset.id)
                                  }
                                  className={`text-[10px] px-2.5 py-1 rounded inline-flex items-center gap-1 transition duration-300 cursor-pointer ${
                                    isActive
                                      ? "bg-emerald-600 text-white font-bold border border-emerald-500 hover:bg-emerald-555"
                                      : "bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white"
                                  }`}
                                >
                                  {isActive && (
                                    <Check className="w-3 h-3 shrink-0" />
                                  )}
                                  {asset.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Playlists selector area */}
                      {playlists.length > 0 && (
                        <div className="border-t border-slate-900 pt-2.5 flex flex-col gap-2">
                          <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                            Transmitir Playlist em Loop:
                          </span>

                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                            {playlists.map((playlist) => {
                              const isActive =
                                screen.contentType === "playlist" &&
                                screen.contentId === playlist.id;

                              return (
                                <button
                                  key={playlist.id}
                                  onClick={() =>
                                    handleAssignPlaylist(screen.id, playlist.id)
                                  }
                                  className={`text-[10px] px-2.5 py-1 rounded inline-flex items-center gap-1 transition duration-300 cursor-pointer ${
                                    isActive
                                      ? "bg-indigo-650 text-white font-bold border border-indigo-500 hover:bg-indigo-700"
                                      : "bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white"
                                  }`}
                                >
                                  {isActive && (
                                    <Check className="w-3 h-3 shrink-0" />
                                  )}
                                  📋 {playlist.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Weekly Timer Schedule configuration section */}
                      <div className="border-t border-slate-900 pt-3 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => toggleScheduleSection(screen)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider flex items-center justify-between w-full transition cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5 font-bold">
                            <Clock className="w-3.5 h-3.5" />
                            Programador Semanal (Timer Horário)
                          </span>
                          {expandedSchedules[screen.id] ? (
                            <ChevronUp className="w-3.5 h-3.5 text-indigo-500" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                          )}
                        </button>

                        {expandedSchedules[screen.id] &&
                          localSchedules[screen.id] && (
                            <div className="mt-2 space-y-3 bg-slate-950/50 rounded-lg p-3 border border-slate-900 text-xs text-slate-350 animate-fade-in">
                              <p className="text-[10px] text-slate-400 leading-normal">
                                Configure em quais horários este monitor poderá
                                sintonizar e exibir conteúdos automaticamente.
                                Nos horários desativados, a tela exibirá uma{" "}
                                <strong>tela preta</strong> para economizar
                                energia.
                              </p>

                              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                {DAYS_OF_WEEK.map(({ key, label }) => {
                                  const dayConfig = localSchedules[screen.id][
                                    key
                                  ] || {
                                    enabled: false,
                                    startTime: "08:00",
                                    endTime: "18:00",
                                  };
                                  return (
                                    <div
                                      key={key}
                                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 bg-slate-900/40 rounded border border-slate-850/65"
                                    >
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          id={`schedule-${screen.id}-${key}`}
                                          checked={dayConfig.enabled}
                                          onChange={(e) => {
                                            const checked = e.target.checked;
                                            setLocalSchedules((prev) => ({
                                              ...prev,
                                              [screen.id]: {
                                                ...prev[screen.id],
                                                [key]: {
                                                  ...dayConfig,
                                                  enabled: checked,
                                                },
                                              },
                                            }));
                                          }}
                                          className="rounded border-slate-705 bg-slate-800 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
                                        />
                                        <label
                                          htmlFor={`schedule-${screen.id}-${key}`}
                                          className="font-bold text-[11px] text-slate-300 select-none cursor-pointer"
                                        >
                                          {label}
                                        </label>
                                      </div>

                                      {dayConfig.enabled && (
                                        <div className="flex items-center gap-1.5 text-[10px]">
                                          <span className="text-slate-500">
                                            Início:
                                          </span>
                                          <input
                                            type="time"
                                            value={dayConfig.startTime}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setLocalSchedules((prev) => ({
                                                ...prev,
                                                [screen.id]: {
                                                  ...prev[screen.id],
                                                  [key]: {
                                                    ...dayConfig,
                                                    startTime: val,
                                                  },
                                                },
                                              }));
                                            }}
                                            className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-white outline-hidden focus:border-indigo-500 text-xxs font-bold"
                                          />
                                          <span className="text-slate-500">
                                            Fim:
                                          </span>
                                          <input
                                            type="time"
                                            value={dayConfig.endTime}
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setLocalSchedules((prev) => ({
                                                ...prev,
                                                [screen.id]: {
                                                  ...prev[screen.id],
                                                  [key]: {
                                                    ...dayConfig,
                                                    endTime: val,
                                                  },
                                                },
                                              }));
                                            }}
                                            className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-white outline-hidden focus:border-indigo-500 text-xxs font-bold"
                                          />
                                        </div>
                                      )}
                                      {!dayConfig.enabled && (
                                        <span className="text-[10px] italic text-slate-500">
                                          Ativo o dia todo (Sem restrição)
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              <button
                                type="button"
                                disabled={savingSchedule === screen.id}
                                onClick={() =>
                                  handleSaveScreenSchedule(
                                    screen.id,
                                    localSchedules[screen.id],
                                  )
                                }
                                className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded font-bold text-xs transition duration-200 cursor-pointer disabled:opacity-60 shadow-sm"
                              >
                                {savingSchedule === screen.id ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Atualizando Horários...</span>
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Salvar Programação Semanal</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="p-4 bg-indigo-950/20 border border-indigo-500/10 rounded-xl space-y-2 text-xs text-indigo-300 select-none">
              <div className="flex items-center gap-1.5 font-bold uppercase text-[10px] tracking-wider text-indigo-400">
                <Info className="w-3.5 h-3.5 shrink-0" />
                Como Testar os Displays em Tempo Real?
              </div>
              <p className="leading-relaxed text-slate-400 text-[11px]">
                1. Clique no link{" "}
                <strong className="text-white">"Player"</strong> em qualquer
                display para abrir o simulador de tela.
                <br />
                2. Na lista de produtos ao lado, clique em qualquer produto para
                enviá-lo instantaneamente.
                <br />
                3. A imagem sintonizada responderá no monitor em milissegundos
                sem precisar dar refresh.
              </p>
            </div>
          </div>

          {/* COLUMN 2: Product Images & Assets (LGs-5/12) */}
          <div
            className={`space-y-6 ${activeTab === "assets" ? "block" : "hidden"}`}
          >
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="block text-xs uppercase font-mono tracking-wider text-indigo-400 font-bold">
                  Seção 02
                </span>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-indigo-400" />
                  Imagens de Produtos ({assets.length})
                </h2>
              </div>

              <button
                onClick={() => setIsAddAssetOpen(!isAddAssetOpen)}
                id="btn-portal-add-product"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs font-bold transition duration-300 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-indigo-400" />
                Novo Produto
              </button>
            </div>

            {/* Add product Asset form */}
            {(isAddAssetOpen || assets.length === 0) && (
              <form
                onSubmit={handleAddProduct}
                className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4 animate-slide-up"
              >
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 mb-0.5">
                    Cadastrar Novo Produto
                  </h3>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    Adicione mídias para a exibição do seu estabelecimento. Você
                    pode enviar arquivos direto do computador ou informar uma
                    URL da web.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Left Column: Form Fields */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11.5px] text-slate-400 font-bold mb-1">
                        Nome do Produto / Conteúdo
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Tabela de Preços, Combo Burger"
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 text-white rounded-lg px-3 py-2 text-xs focus:outline-hidden focus:border-indigo-500"
                      />
                    </div>

                    {/* Choice of upload method */}
                    <div>
                      <label className="block text-[11px] text-slate-400 font-bold mb-1.5">
                        Origem do Arquivo
                      </label>
                      <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                        <button
                          type="button"
                          onClick={() => {
                            setUploadMethod("url");
                            setNewProductUrl("");
                            setFileBase64("");
                          }}
                          className={`flex-1 py-1.5 text-center text-xs font-medium rounded-md transition ${
                            uploadMethod === "url"
                              ? "bg-indigo-600 text-white shadow"
                              : "text-slate-455 hover:text-slate-200"
                          }`}
                        >
                          🔗 Link da URL
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadMethod("file");
                            setNewProductUrl("");
                            setFileBase64("");
                          }}
                          className={`flex-1 py-1.5 text-center text-xs font-medium rounded-md transition ${
                            uploadMethod === "file"
                              ? "bg-indigo-600 text-white shadow"
                              : "text-slate-455 hover:text-slate-200"
                          }`}
                        >
                          📤 Do Computador
                        </button>
                      </div>
                    </div>

                    {/* Content type toggle */}
                    <div className="flex gap-2 items-center pt-0.5">
                      <span className="text-[10px] text-slate-400 font-bold">
                        Tipo:
                      </span>
                      <button
                        type="button"
                        onClick={() => setFileType("image")}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded transition border ${
                          fileType === "image"
                            ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                            : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400"
                        }`}
                      >
                        Imagem / Foto
                      </button>
                      <button
                        type="button"
                        onClick={() => setFileType("video")}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded transition border ${
                          fileType === "video"
                            ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                            : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-400"
                        }`}
                      >
                        Vídeo (MP4)
                      </button>
                    </div>

                    {uploadMethod === "url" ? (
                      <div>
                        <label className="block text-[11px] text-slate-400 font-bold mb-1">
                          URL da Imagem ou Vídeo
                        </label>
                        <input
                          type="url"
                          required={uploadMethod === "url"}
                          placeholder="Ex: https://pizzas.com/foto.jpg ou .mp4"
                          value={newProductUrl}
                          onChange={(e) => {
                            setNewProductUrl(e.target.value);
                            const lower = e.target.value.toLowerCase();
                            if (
                              lower.endsWith(".mp4") ||
                              lower.endsWith(".webm") ||
                              lower.endsWith(".ogg") ||
                              lower.includes("video")
                            ) {
                              setFileType("video");
                            } else {
                              setFileType("image");
                            }
                          }}
                          className="w-full bg-slate-900 border border-slate-800 text-white rounded-lg px-3 py-2 text-[11px] font-mono focus:outline-hidden focus:border-indigo-500"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[11px] text-slate-400 font-bold mb-1">
                          Arquivo local
                        </label>
                        <div className="relative border border-dashed border-slate-800 hover:border-indigo-500/50 rounded-xl p-3 bg-slate-900 text-center transition group cursor-pointer duration-200">
                          <input
                            type="file"
                            accept="image/*,video/*"
                            required={uploadMethod === "file" && !fileBase64}
                            onChange={handleFileChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                          <div className="space-y-1">
                            <Plus className="w-4 h-4 mx-auto text-slate-500 group-hover:text-indigo-400 transition" />
                            <span className="block text-[10.5px] font-semibold text-slate-300">
                              Navegar ou Soltar Arquivo
                            </span>
                            <span className="block text-[9px] text-slate-500">
                              Imagens ou vídeos leves de até 800KB.
                            </span>
                          </div>
                        </div>
                        {fileBase64 && (
                          <div className="text-[10px] text-slate-400 mt-1.5 flex justify-between items-center bg-slate-900/65 p-1.5 rounded border border-slate-800">
                            <span className="truncate max-w-[140px] text-indigo-400 font-mono">
                              📄 Carregado (
                              {Math.round((fileBase64.length * 0.75) / 1024)}{" "}
                              KB)
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setFileBase64("");
                                setNewProductUrl("");
                              }}
                              className="text-rose-400 hover:text-rose-300 font-bold px-1"
                            >
                              Excluir
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right Column: TV Display Monitor live preview */}
                  <div className="flex flex-col justify-between space-y-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      📺 Monitor de Preview (Ao Vivo):
                    </span>
                    <div className="flex-1 border-4 border-slate-800 rounded-xl bg-slate-950 overflow-hidden shadow-inner aspect-video relative flex items-center justify-center p-0.5">
                      <div className="absolute top-1.5 left-2 z-10 bg-indigo-600/90 text-white px-2 py-0.5 rounded-[4px] text-[7.5px] font-bold uppercase tracking-widest animate-pulse border border-indigo-400/20">
                        PREVIEW REALTIME
                      </div>

                      {newProductUrl.trim() ? (
                        fileType === "video" ? (
                          <video
                            src={newProductUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={newProductUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <div className="text-center p-4 space-y-1 bg-slate-900/40 rounded-lg border border-slate-800/50">
                          {fileType === "video" ? (
                            <Play className="w-6 h-6 text-slate-700 mx-auto animate-pulse" />
                          ) : (
                            <ImageIcon className="w-6 h-6 text-slate-700 mx-auto animate-pulse" />
                          )}
                          <p className="text-[9.5px] text-slate-500 font-semibold leading-tight">
                            Aguardando mídia para renderizar no player...
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 flex justify-end gap-2 text-xs">
                      {assets.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddAssetOpen(false);
                            setNewProductName("");
                            setNewProductUrl("");
                            setFileBase64("");
                            setFileType("image");
                            setUploadMethod("url");
                          }}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white"
                        >
                          Cancelar
                        </button>
                      )}
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition shrink-0 cursor-pointer"
                      >
                        Salvar Produto
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {/* Products Asset Grid view */}
            {loadingAssets ? (
              <div className="p-8 text-center bg-slate-950/40 border border-slate-800 rounded-xl">
                <RefreshCw className="w-5 h-5 animate-spin text-indigo-500 mx-auto mb-2" />
                <p className="text-[11px] text-slate-500 font-mono tracking-widest uppercase">
                  Indexando vitrine...
                </p>
              </div>
            ) : assets.length === 0 ? (
              <div className="p-8 text-center bg-slate-950/20 border border-white/5 border-dashed rounded-xl">
                <ImageIcon className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-slate-500">
                  Nenhum produto cadastrado na vitrine.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-2">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="bg-slate-950 border border-slate-850/80 hover:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow group"
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                      {/* Badge overlay indicating format type explicitly contextually */}
                      <div className="absolute top-2 right-2 z-10 bg-slate-900/80 backdrop-blur-md text-[8px] font-bold text-slate-300 px-2 py-0.5 rounded border border-white/5">
                        {asset.type === "video" ? "📹 VÍDEO" : "🖼️ IMAGEM"}
                      </div>

                      {asset.type === "video" ? (
                        <video
                          src={asset.url}
                          autoPlay
                          loop
                          muted
                          playsInline
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                        />
                      ) : (
                        <img
                          src={asset.url}
                          alt={asset.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=500&auto=format&fit=crop&q=60";
                          }}
                        />
                      )}
                    </div>

                    <div className="p-3 flex-1 flex flex-col justify-between gap-3">
                      <h4 className="text-xs font-bold text-white truncate leading-tight">
                        {asset.name}
                      </h4>

                      <div className="flex items-center justify-between border-t border-slate-900 pt-2 shrink-0">
                        <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          Pronto
                        </span>

                        <button
                          onClick={() =>
                            handleRemoveProduct(asset.id, asset.name)
                          }
                          className="p-1 px-2 rounded hover:bg-red-500/10 hover:text-red-400 text-slate-500 transition duration-300 cursor-pointer flex items-center gap-1 text-[10px]"
                          title="Excluir Imagem do Produto"
                        >
                          <Trash2 className="w-3 h-3" />
                          Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section 03: Playlists de Exibição */}
        <div
          id="playlist-management-section"
          className={`border-t border-slate-800/80 pt-8 space-y-6 ${activeTab === "playlists" ? "block animate-fade-in" : "hidden"}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <span className="block text-xs uppercase font-mono tracking-wider text-indigo-400 font-bold">
                Seção 03
              </span>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                Playlists de Exibição ({playlists.length})
              </h2>
              <p className="text-xs text-slate-400">
                Seu canal de conteúdo em loop. Organize sequências de imagens e
                vídeos para suas Smart TVs.
              </p>
            </div>

            <button
              onClick={() => {
                if (isAddPlaylistOpen) {
                  setIsAddPlaylistOpen(false);
                  setEditingPlaylist(null);
                  setPlaylistName("");
                  setPlaylistItems([]);
                  initializePlaylistSchedule();
                } else {
                  setIsAddPlaylistOpen(true);
                  setEditingPlaylist(null);
                  setPlaylistName("");
                  setPlaylistItems([]);
                  initializePlaylistSchedule();
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-650 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition duration-300 shadow-lg cursor-pointer self-start sm:self-auto"
            >
              {isAddPlaylistOpen ? (
                <X className="w-4 h-4" />
              ) : (
                <ListPlus className="w-4 h-4" />
              )}
              {isAddPlaylistOpen ? "Fechar Editor" : "Criar Nova Playlist"}
            </button>
          </div>

          {/* Form Creator / Editor */}
          {isAddPlaylistOpen && (
            <div className="p-6 bg-slate-950 border border-slate-800 rounded-2xl space-y-6 animate-slide-up">
              <div className="border-b border-slate-900 pb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {editingPlaylist
                      ? "✏️ Editar Playlist de Exibição"
                      : "📋 Nova Playlist de Exibição"}
                  </h3>
                  <p className="text-xs text-slate-550">
                    Defina o nome da playlist, selecione seus produtos e ajuste
                    a duração de exibição de cada slide.
                  </p>
                </div>
                {editingPlaylist && (
                  <span className="text-[10px] bg-amber-500/10 text-amber-400 font-mono font-bold px-2.5 py-1 rounded-full border border-amber-500/20">
                    Editando ID: {editingPlaylist.id}
                  </span>
                )}
              </div>

              <form
                onSubmit={handleSavePlaylist}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-xs"
              >
                {/* Column A: Playlist Details and Loop Order (7 cols) */}
                <div className="lg:col-span-7 space-y-5">
                  <div className="space-y-1.5">
                    <label className="block text-slate-400 font-bold">
                      Título da Playlist
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Ofertas da Semana, Loop Menu de Almoço"
                      value={playlistName}
                      onChange={(e) => setPlaylistName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 text-white rounded-xl px-4 py-3 text-xs focus:outline-hidden focus:border-indigo-500 font-medium"
                    />
                  </div>

                  {/* Collapsible Playlist Weekly Schedule */}
                  <div className="border border-slate-800 rounded-xl p-3.5 space-y-2 bg-slate-950/65">
                    <button
                      type="button"
                      onClick={() =>
                        setIsPlaylistScheduleOpen(!isPlaylistScheduleOpen)
                      }
                      className="text-[10.5px] text-indigo-400 hover:text-indigo-350 font-extrabold uppercase tracking-widest flex items-center justify-between w-full transition cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-indigo-400" />
                        PROGRAMADOR SEMANAL DE EXIBIÇÃO (PLAYLIST TIMER)
                      </span>
                      {isPlaylistScheduleOpen ? (
                        <ChevronUp className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      )}
                    </button>

                    {isPlaylistScheduleOpen && (
                      <div className="pt-3.5 border-t border-slate-900 space-y-3.5 text-xs text-slate-300 animate-slide-up">
                        <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                          Ajuste o expediente desta playlist. Fora dos horários
                          permitidos definidos abaixo, a Smart TV exibirá uma{" "}
                          <strong>tela preta</strong> se esta playlist estiver
                          ativa.
                        </p>

                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {[
                            { key: "monday", label: "Segunda-feira" },
                            { key: "tuesday", label: "Terça-feira" },
                            { key: "wednesday", label: "Quarta-feira" },
                            { key: "thursday", label: "Quinta-feira" },
                            { key: "friday", label: "Sexta-feira" },
                            { key: "saturday", label: "Sábado" },
                            { key: "sunday", label: "Domingo" },
                          ].map(({ key, label }) => {
                            const dayConfig = playlistSchedule[key] || {
                              enabled: false,
                              startTime: "08:00",
                              endTime: "18:00",
                            };
                            return (
                              <div
                                key={key}
                                className="flex items-center justify-between gap-3 p-2 bg-slate-900 border border-slate-850 rounded-xl text-slate-200"
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`client-playlist-sched-${key}`}
                                    checked={dayConfig.enabled}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setPlaylistSchedule((prev) => ({
                                        ...prev,
                                        [key]: {
                                          ...dayConfig,
                                          enabled: checked,
                                        },
                                      }));
                                    }}
                                    className="rounded border-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-950 bg-slate-950 h-4 w-4 cursor-pointer"
                                  />
                                  <label
                                    htmlFor={`client-playlist-sched-${key}`}
                                    className="font-bold text-[11px] select-none cursor-pointer text-slate-200"
                                  >
                                    {label}
                                  </label>
                                </div>

                                {dayConfig.enabled ? (
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                      Das
                                    </span>
                                    <input
                                      type="time"
                                      value={dayConfig.startTime}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setPlaylistSchedule((prev) => ({
                                          ...prev,
                                          [key]: {
                                            ...dayConfig,
                                            startTime: val,
                                          },
                                        }));
                                      }}
                                      className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-250 outline-none focus:border-indigo-500 text-xs font-bold"
                                    />
                                    <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                                      Até
                                    </span>
                                    <input
                                      type="time"
                                      value={dayConfig.endTime}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setPlaylistSchedule((prev) => ({
                                          ...prev,
                                          [key]: { ...dayConfig, endTime: val },
                                        }));
                                      }}
                                      className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-250 outline-none focus:border-indigo-500 text-xs font-bold"
                                    />
                                  </div>
                                ) : (
                                  <span className="text-[10px] font-semibold text-slate-500 italic">
                                    Disponível o dia todo
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="block text-slate-400 font-bold">
                        Itens do Loop ({playlistItems.length}):
                      </span>
                      {playlistItems.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPlaylistItems([])}
                          className="text-[10px] text-red-400 hover:underline cursor-pointer"
                        >
                          Limpar tudo
                        </button>
                      )}
                    </div>

                    {playlistItems.length === 0 ? (
                      <div className="p-8 text-center bg-slate-905/40 border border-slate-850 border-dashed rounded-xl select-none">
                        <Layers className="w-8 h-8 text-slate-700 mx-auto mb-2 animate-pulse" />
                        <p className="text-slate-500 font-medium leading-relaxed">
                          Nenhum produto adicionado à sequência.
                          <br />
                          <span className="text-[11px] text-indigo-400 font-bold">
                            Clique nos produtos da vitrine ao lado &rarr;
                          </span>{" "}
                          para incorporá-los no loop.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                        {playlistItems.map((item, index) => (
                          <div
                            key={index}
                            className="p-3 bg-slate-900/80 border border-slate-850 hover:border-slate-800 rounded-xl flex items-center justify-between gap-4 animate-fade-in"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Sequence index badge */}
                              <span className="w-5 h-5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-mono text-[10px] font-bold shrink-0">
                                {index + 1}
                              </span>

                              <div className="w-10 aspect-video rounded overflow-hidden bg-[#0a0c16] shrink-0 border border-slate-850">
                                <img
                                  src={item.url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              </div>

                              <div className="truncate">
                                <p className="font-bold text-white truncate text-xs leading-normal">
                                  {item.name}
                                </p>
                                <span className="text-[9px] uppercase font-bold text-slate-550 font-mono tracking-wider">
                                  {item.type === "video"
                                    ? "📹 Vídeo"
                                    : "🖼️ Imagem"}
                                </span>
                              </div>
                            </div>

                            {/* Timing duration and order controls */}
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-850">
                                <input
                                  type="number"
                                  min="1"
                                  required
                                  value={item.duration}
                                  onChange={(e) =>
                                    handlePlaylistDurationChange(
                                      index,
                                      parseInt(e.target.value) || 10,
                                    )
                                  }
                                  className="w-10 bg-transparent text-center font-mono text-xs font-bold text-emerald-450 focus:outline-hidden"
                                />
                                <span className="text-[10px] text-slate-500 font-bold uppercase select-none">
                                  seg
                                </span>
                              </div>

                              <div className="flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-850">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() =>
                                    handleMovePlaylistItemUp(index)
                                  }
                                  className="p-1 hover:text-white text-slate-500 disabled:opacity-30 transition cursor-pointer"
                                  title="Subir na ordem"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === playlistItems.length - 1}
                                  onClick={() =>
                                    handleMovePlaylistItemDown(index)
                                  }
                                  className="p-1 hover:text-white text-slate-500 disabled:opacity-30 transition cursor-pointer"
                                  title="Descer na ordem"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  handleRemoveItemFromPlaylist(index)
                                }
                                className="p-1 text-slate-550 hover:text-rose-400 transition cursor-pointer"
                                title="Retirar do loop"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-900 flex justify-end gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddPlaylistOpen(false);
                        setEditingPlaylist(null);
                        setPlaylistName("");
                        setPlaylistItems([]);
                      }}
                      className="px-4 py-2 font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-indigo-650 hover:bg-indigo-600 text-white rounded-xl font-bold transition shadow-lg cursor-pointer flex items-center gap-1.5"
                    >
                      <Save className="w-4 h-4" />
                      {editingPlaylist ? "Salvar Edição" : "Publicar Playlist"}
                    </button>
                  </div>
                </div>

                {/* Column B: Showcase Picker (5 cols) */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="space-y-1">
                    <span className="block text-slate-400 font-bold">
                      Vitrine de Mídias
                    </span>
                    <p className="text-[11px] text-slate-500 leading-normal">
                      Clique no botão "
                      <span className="text-white hover:underline">
                        + Incluir
                      </span>
                      " para empilhar o produto no loop da playlist.
                    </p>
                  </div>

                  <div className="bg-slate-900/30 border border-slate-900/60 rounded-xl p-3 max-h-[420px] overflow-y-auto space-y-2">
                    {assets.length === 0 ? (
                      <div className="p-6 text-center text-slate-550 italic select-none">
                        Cadastre mídias na Seção 02 primeiro.
                      </div>
                    ) : (
                      assets.map((asset) => (
                        <div
                          key={asset.id}
                          className="p-2.5 bg-slate-950 border border-slate-850 hover:border-slate-800 rounded-lg flex items-center justify-between gap-3 group transition"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-10 aspect-video rounded bg-slate-900 overflow-hidden shrink-0 border border-slate-850">
                              <img
                                src={asset.url}
                                alt=""
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                            <span className="font-semibold text-slate-300 truncate text-[11px] block pr-1 leading-normal">
                              {asset.name}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleAddAssetToPlaylist(asset)}
                            className="px-2.5 py-1 text-[10px] font-bold bg-indigo-650/30 hover:bg-indigo-600 border border-indigo-500/20 text-indigo-300 hover:text-white rounded-md transition duration-200 cursor-pointer flex items-center gap-0.5 shrink-0"
                          >
                            <Plus className="w-3 h-3" />
                            Incluir
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </form>
            </div>
          )}

          {/* Active Playlists Catalog */}
          {loadingPlaylists ? (
            <div className="p-8 text-center bg-slate-950/40 border border-slate-800 rounded-2xl select-none">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-500 mx-auto mb-2" />
              <p className="text-[11px] text-slate-500 font-mono tracking-widest uppercase">
                Consultando playlists...
              </p>
            </div>
          ) : playlists.length === 0 ? (
            <div className="p-10 text-center bg-slate-950/40 border border-dashed border-slate-805/80 rounded-2xl space-y-3">
              <Layers className="w-10 h-10 text-slate-800 mx-auto animate-pulse" />
              <div>
                <h4 className="text-sm font-bold text-slate-400">
                  Nenhuma playlist ativa
                </h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                  Você não criou nenhuma playlist de loop para suas telas ainda.
                  Desenhe sua primeira playlist para transmitir slides de
                  imagens ou vídeos continuamente de forma sequencial na sua
                  Smart TV.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {playlists.map((playlist) => {
                const totalDuration =
                  playlist.items?.reduce(
                    (acc, curr) => acc + (curr.duration || 10),
                    0,
                  ) || 0;

                return (
                  <div
                    key={playlist.id}
                    className="p-5 bg-slate-950/85 border border-slate-850 hover:border-slate-800 rounded-xl flex flex-col justify-between gap-5 transition shadow-sm relative overflow-hidden group"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <h4
                            className="text-sm font-bold text-white group-hover:text-indigo-400 transition truncate pr-1"
                            title={playlist.name}
                          >
                            {playlist.name}
                          </h4>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono leading-none">
                            <span>🕒 Ciclo: {totalDuration}s</span>
                            <span>&bull;</span>
                            <span>🎞️ {playlist.items?.length || 0} mídias</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleStartEditPlaylist(playlist)}
                            className="p-1.5 hover:text-white text-slate-400 bg-slate-900 border border-slate-850 hover:border-slate-800 rounded-md transition duration-200 cursor-pointer"
                            title="Editar playlist"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() =>
                              handleDeletePlaylist(playlist.id, playlist.name)
                            }
                            className="p-1.5 hover:text-red-400 text-slate-500 bg-slate-900 border border-slate-850 hover:border-slate-800 rounded-md transition duration-200 cursor-pointer"
                            title="Excluir playlist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Micro slide preview thumbnails strip */}
                      <div className="flex gap-1.5 overflow-x-auto py-1 pr-1 border-t border-slate-900 pt-2.5 max-w-full scrollbar-none">
                        {playlist.items?.map((item, idx) => (
                          <div
                            key={idx}
                            className="w-10 h-7 rounded border border-slate-850 bg-slate-900 overflow-hidden shrink-0 relative hover:scale-105 transition"
                            title={`${idx + 1}. ${item.name} (${item.duration}s)`}
                          >
                            <img
                              src={item.url}
                              alt=""
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <span className="absolute bottom-0 right-0 z-10 bg-slate-950/80 text-[6.5px] font-bold text-emerald-450 px-0.5 font-mono">
                              {item.duration}s
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Quick screen pairing/binding selector for looping playlist */}
                      <div className="border-t border-slate-900 pt-3 mt-1.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <Tv className="w-3.5 h-3.5 text-indigo-400" />
                            Transmitir no canais de TV:
                          </span>
                        </div>
                        {screens.length === 0 ? (
                          <p className="text-[10px] text-slate-505 italic">
                            Nenhuma TV cadastrada nesta conta. Ative uma TV na
                            Seção 01.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {screens.map((screen) => {
                              const isActive =
                                screen.contentType === "playlist" &&
                                screen.contentId === playlist.id;
                              return (
                                <button
                                  key={screen.id}
                                  type="button"
                                  onClick={() =>
                                    handleAssignPlaylist(screen.id, playlist.id)
                                  }
                                  className={`text-[9.5px] px-2 py-1 rounded-md font-bold uppercase transition duration-200 cursor-pointer flex items-center gap-1.5 ${
                                    isActive
                                      ? "bg-indigo-650 text-white font-bold border border-indigo-550 shadow"
                                      : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-white hover:bg-slate-800"
                                  }`}
                                  title={
                                    isActive
                                      ? `Playlist transmitindo em ${screen.name}`
                                      : `Sintonizar no monitor ${screen.name}`
                                  }
                                >
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`}
                                  />
                                  {screen.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Global Footer info requested by user */}
        <footer className="mt-12 pt-6 pb-2 border-t border-slate-800/80 text-center select-none text-[11px] text-slate-500 font-medium tracking-wide">
          Vitrion Smart Display ©2026
        </footer>
      </div>


      {/* Edit Client Profile Modal Dialog */}
      {isEditClientOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-[60] overflow-y-auto animate-fade-in text-white font-sans">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-scale-up my-auto flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <header className="p-5 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/45">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-650/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold tracking-tight text-white">
                    Configurações de Cadastro
                  </h3>
                  <p className="text-xs text-slate-400 font-medium select-none">
                    Atualize os dados cadastrais e as credenciais de acesso do
                    seu estabelecimento.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditClientOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            {/* Modal Body / Form */}
            <form
              onSubmit={handleSaveClientProfile}
              className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-900 text-slate-300"
            >
              {/* Profile Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Establishment Name */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Nome do Estabelecimento *
                  </label>
                  <input
                    type="text"
                    required
                    value={editEstName}
                    onChange={(e) => setEditEstName(e.target.value)}
                    placeholder="Ex: Supermercado Central"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Email Address */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    E-mail do Cliente
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="Ex: contato@estabelecimento.com"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Telefone Fixo
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="Ex: (27) 3333-4444"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* WhatsApp */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Celular / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={editWhatsApp}
                    onChange={(e) => setEditWhatsApp(e.target.value)}
                    placeholder="Ex: (27) 99999-8888"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* CEP/ZIP Code */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    CEP
                  </label>
                  <input
                    type="text"
                    value={editCEP}
                    onChange={(e) => setEditCEP(e.target.value)}
                    placeholder="Ex: 29000-000"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Address */}
                <div className="space-y-1.5 md:col-span-2">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Endereço Completo
                  </label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    placeholder="Ex: Av. Principal, 123, Centro"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* City */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Cidade
                  </label>
                  <input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    placeholder="Ex: Vitória"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* State */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Estado (Sigla / UF)
                  </label>
                  <input
                    type="text"
                    value={editState}
                    onChange={(e) => setEditState(e.target.value)}
                    placeholder="Ex: ES"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Credentials Section Divider */}
                <div className="md:col-span-2 pt-3 border-t border-slate-800/60 mt-2">
                  <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider block">
                    Credenciais de Login de Usuário
                  </span>
                  <p className="text-[10px] text-slate-450 mt-0.5 select-none">
                    Essas informações são as que você utiliza para acessar este
                    portal.
                  </p>
                </div>

                {/* Username */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Nome de Usuário (Login) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                    placeholder="Ex: estabelecimento1"
                    className="w-full bg-slate-950 border border-slate-800/80 rounded-xl px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors font-mono"
                  />
                </div>

                {/* Password with visibility toggle */}
                <div className="space-y-1.5">
                  <label className="block text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
                    Senha de Acesso *
                  </label>
                  <div className="relative">
                    <input
                      type={showEditPassword ? "text" : "password"}
                      required
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="Senha forte"
                      className="w-full bg-slate-950 border border-slate-800/80 rounded-xl pl-3 pr-10 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500 transition-colors font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200 transition"
                      title="Exibir/Ocultar Senha"
                    >
                      {showEditPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Action buttons footer */}
              <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-800/85 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsEditClientOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-350 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingClient}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-505 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  {isSavingClient ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      Salvar Alterações
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
