import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Fuel, Timer, Gauge, Calculator, Info, Flag, Wrench, Settings2, ListChecks, ArrowRightLeft, Clock, AlertTriangle, Save, Bookmark, Maximize, Minimize, Trash2, X, Play, CloudRain } from 'lucide-react';

interface Preset {
  id: string;
  name: string;
  raceDuration: number | '';
  lapMin: number | '';
  lapSec: number | '';
  fuelPerLap: number | '';
  wetLapMin?: number | '';
  wetLapSec?: number | '';
  wetFuelPerLap?: number | '';
  tankCapacity: number | '';
  mandatoryPitStops: number | '';
  maxStintTime: number | '';
  pitLossTime?: number | '';
  tireChangeTime?: number | '';
  refuelTimePerL?: number | '';
  safetyMarginLaps?: number | '';
  minReserveFuel?: number | '';
  tyrePressureMin?: number | '';
  tyrePressureMax?: number | '';
  extraLaps: number | '';
  strategyType: 'equal' | 'full';
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface AccBridgeTelemetry {
  packetId?: number;
  fuel?: number;
  fuelPerLap?: number;
  lap?: number;
  position?: number;
  currentLapTime?: string;
  lastLapTime?: string;
  bestLapTime?: string;
  isInPit?: boolean;
  isInPitLane?: boolean;
  flag?: number;
  rainIntensity?: number;
  trackGripStatus?: number;
  idealLineGrip?: number;
  rainIntensityIn10min?: number;
  rainIntensityIn30min?: number;
  roadTemp?: number;
  tyrePressure?: number[];
  tyreWear?: number[];
  tyreTemp?: number[];
  sessionType?: number;
  sessionTimeLeft?: number;
  numberOfLaps?: number;
  trackLength?: number;
  maxFuel?: number;
  connected?: boolean;
}

interface AccBridgeFrame {
  telemetry?: AccBridgeTelemetry;
  strategy?: {
    pitRecommended?: boolean;
    estimatedLapsRemaining?: number;
    summary?: string;
  };
}

const DEFAULT_ACC_BRIDGE_URL = 'ws://localhost:8081';

const roundTo = (value: number, digits: number) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

// ACCのtrackGripStatus (0-6) のラベル。数値の並びはACCの標準スケールに準拠。
const TRACK_GRIP_LABELS = ['Green', 'Fast', 'Optimum', 'Greasy', 'Damp', 'Wet', 'Flooded'];

// ACCのflag (AC_FLAG_TYPE, 0-6) を「今すべきこと」に翻訳するテーブル。
// Green/Redは共有メモリのflagに直接対応する値が無いため、Noneを「クリア(Green相当)」として扱う。
const FLAG_INFO: Record<number, { label: string; advice: string; tone: 'neutral' | 'caution' | 'danger' | 'info' }> = {
  0: { label: 'クリア (No Flag)', advice: '通常走行', tone: 'neutral' },
  1: { label: 'ブルーフラッグ', advice: '後方に速い車。道を譲ってください', tone: 'info' },
  2: { label: 'イエローフラッグ', advice: 'オーバーテイク禁止。燃費セーブのチャンス', tone: 'caution' },
  3: { label: 'ブラックフラッグ', advice: 'ピットイン指示の可能性があります', tone: 'danger' },
  4: { label: 'ホワイトフラッグ', advice: '低速車が前方にいます。注意', tone: 'caution' },
  5: { label: 'チェッカーフラッグ', advice: 'セッション終了', tone: 'info' },
  6: { label: 'ペナルティフラッグ', advice: 'ペナルティが課されています', tone: 'danger' },
};

// ACCのAC_SESSION_TYPE (-1=Unknown,0=Practice,1=Qualify,2=Race,3=Hotlap,4=TimeAttack,5=Drift,6=Drag)
const SESSION_TYPE_LABELS: Record<number, string> = {
  [-1]: 'Unknown',
  0: 'Practice',
  1: 'Qualify',
  2: 'Race',
  3: 'Hotlap',
  4: 'Time Attack',
  5: 'Drift',
  6: 'Drag',
};

// タイヤ温度・摩耗の判定しきい値(GT3一般的な目安。車種により異なるため参考値)
const TYRE_TEMP_COLD_MAX = 70; // これ未満: Cold
const TYRE_TEMP_HOT_MAX = 100; // これ以下: Optimal, 超えたらOverheated
const TYRE_WEAR_CAUTION = 15; // %, これ以上でCaution
const TYRE_WEAR_REPLACE = 30; // %, これ以上でReplace(ACC仕様: 0=新品,100=完全摩耗)
const TYRE_LABELS = ['FL', 'FR', 'RL', 'RR'];

export default function App() {
  const [raceDuration, setRaceDuration] = useState<number | ''>(60);
  const [lapMin, setLapMin] = useState<number | ''>(1);
  const [lapSec, setLapSec] = useState<number | ''>(48.5);
  const [fuelPerLap, setFuelPerLap] = useState<number | ''>(3.4);
  const [extraLaps, setExtraLaps] = useState<number | ''>(1);
  
  const [wetLapMin, setWetLapMin] = useState<number | ''>('');
  const [wetLapSec, setWetLapSec] = useState<number | ''>('');
  const [wetFuelPerLap, setWetFuelPerLap] = useState<number | ''>('');

  // Pit Strategy States
  const [tankCapacity, setTankCapacity] = useState<number | ''>(110);
  const [mandatoryPitStops, setMandatoryPitStops] = useState<number | ''>(0);
  const [maxStintTime, setMaxStintTime] = useState<number | ''>(65);
  const [strategyType, setStrategyType] = useState<'equal' | 'full'>('equal');

  // ACC Specific Pit States
  const [pitLossTime, setPitLossTime] = useState<number | ''>(30);
  const [tireChangeTime, setTireChangeTime] = useState<number | ''>(30);
  const [refuelTimePerL, setRefuelTimePerL] = useState<number | ''>(0.2);

  // Alert & Safety Settings (④ 設定画面)
  const [safetyMarginLaps, setSafetyMarginLaps] = useState<number | ''>(1.0);
  const [minReserveFuel, setMinReserveFuel] = useState<number | ''>(0);
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(true);
  const [tyrePressureMin, setTyrePressureMin] = useState<number | ''>(26.5);
  const [tyrePressureMax, setTyrePressureMax] = useState<number | ''>(27.5);

  // Emergency States
  const [currentLap, setCurrentLap] = useState<number | ''>('');
  const [currentFuel, setCurrentFuel] = useState<number | ''>('');
  const [completedMandatoryPits, setCompletedMandatoryPits] = useState<number | ''>(0);
  const [countsAsMandatory, setCountsAsMandatory] = useState<boolean>(true);
  const [isRaining, setIsRaining] = useState<boolean>(false);

  // Live per-lap fuel tracking (テレメトリーから1周ごとの実測燃費を算出)
  const [lapFuelHistory, setLapFuelHistory] = useState<{ lap: number; fuelUsed: number }[]>([]);
  const [pitExitPrompt, setPitExitPrompt] = useState<{ lap: number | ''; fuel: number | '' } | null>(null);
  const lapFuelHistoryRef = useRef<{ lap: number; fuelUsed: number }[]>([]);
  const lastLapEdgeRef = useRef<{ lap: number; fuel: number } | null>(null);
  const wasInPitRef = useRef(false);
  const pitTouchedSinceLastLapRef = useRef(false);

  // Simple Mode State
  const [isSimpleMode, setIsSimpleMode] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);

  // ACC Bridge Sync State
  const [accBridgeStatus, setAccBridgeStatus] = useState<ConnectionStatus>('disconnected');
  const [accBridgeUrl, setAccBridgeUrl] = useState(() => localStorage.getItem('acc-bridge-url') || DEFAULT_ACC_BRIDGE_URL);
  const [isAccBridgeModalOpen, setIsAccBridgeModalOpen] = useState(false);
  const [accBridgeErrorMsg, setAccBridgeErrorMsg] = useState('');
  const [accBridgeTelemetry, setAccBridgeTelemetry] = useState<AccBridgeTelemetry | null>(null);
  const accBridgeSocketRef = useRef<WebSocket | null>(null);

  // SimHub Sync State
  const [simHubStatus, setSimHubStatus] = useState<ConnectionStatus>('disconnected');
  const [simHubUrl, setSimHubUrl] = useState(() => {
    // If hosted on SimHub's own web server, use its origin to allow access from other devices (like smartphones)
    if (window.location.port === '8888' || window.location.port === '8889') {
      return window.location.origin;
    }
    return 'http://localhost:8888';
  });
  const [isSimHubModalOpen, setIsSimHubModalOpen] = useState(false);
  const [simHubErrorMsg, setSimHubErrorMsg] = useState('');

  // Presets State
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('acc-fuel-presets');
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const accBridgeManualDisconnectRef = useRef(false);
  const accBridgeReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAccBridgeRef = useRef<() => void>(() => {});

  const disconnectAccBridge = useCallback(() => {
    accBridgeManualDisconnectRef.current = true;
    if (accBridgeReconnectTimerRef.current) {
      clearTimeout(accBridgeReconnectTimerRef.current);
      accBridgeReconnectTimerRef.current = null;
    }
    accBridgeSocketRef.current?.close();
    accBridgeSocketRef.current = null;
    setAccBridgeStatus('disconnected');
  }, []);

  const applyAccBridgeTelemetry = useCallback((telemetry: AccBridgeTelemetry) => {
    setAccBridgeTelemetry(telemetry);

    if (telemetry.connected === false) {
      return;
    }

    // --- ピット入退場の検知 ---
    const inPitNow = !!(telemetry.isInPit || telemetry.isInPitLane);
    if (inPitNow) {
      // このピット滞在をまたぐ周は燃費サンプルとして使わない(給油で燃料が増えるため)
      pitTouchedSinceLastLapRef.current = true;
    }
    if (wasInPitRef.current && !inPitNow) {
      // ピットレーンを出た瞬間 = 想定外を含むピット作業の完了を検知
      setPitExitPrompt({
        lap: typeof telemetry.lap === 'number' ? telemetry.lap : '',
        fuel: typeof telemetry.fuel === 'number' ? roundTo(telemetry.fuel, 1) : '',
      });
    }
    wasInPitRef.current = inPitNow;

    // --- 周回検知 + 1周ごとの実測燃費 ---
    if (typeof telemetry.lap === 'number' && Number.isFinite(telemetry.lap) && telemetry.lap >= 0) {
      const newLap = telemetry.lap;
      const prevEdge = lastLapEdgeRef.current;
      const fuelNow = typeof telemetry.fuel === 'number' && Number.isFinite(telemetry.fuel) ? telemetry.fuel : undefined;

      if (prevEdge && newLap > prevEdge.lap) {
        const lapsElapsed = newLap - prevEdge.lap;
        if (fuelNow !== undefined && !pitTouchedSinceLastLapRef.current) {
          const fuelUsedTotal = prevEdge.fuel - fuelNow;
          // 給油等で燃料が減っていない(=正しく消費だけを捉えられた)場合のみ記録
          if (fuelUsedTotal > 0) {
            const perLap = roundTo(fuelUsedTotal / lapsElapsed, 2);
            const nextHistory = [...lapFuelHistoryRef.current.slice(-7), { lap: newLap, fuelUsed: perLap }];
            lapFuelHistoryRef.current = nextHistory;
            setLapFuelHistory(nextHistory);

            // 直近(最大3周)の実測平均を、レース全体平均より優先してfuelPerLapへ反映する
            const recentSamples = nextHistory.slice(-3);
            const avg = recentSamples.reduce((sum, e) => sum + e.fuelUsed, 0) / recentSamples.length;
            setFuelPerLap(roundTo(avg, 2));
          }
        }
        pitTouchedSinceLastLapRef.current = false;
      } else if (prevEdge && newLap < prevEdge.lap) {
        // セッションのリスタート等でラップが巻き戻った場合は履歴をリセット
        lapFuelHistoryRef.current = [];
        setLapFuelHistory([]);
        pitTouchedSinceLastLapRef.current = false;
      }

      if (fuelNow !== undefined) {
        lastLapEdgeRef.current = { lap: newLap, fuel: fuelNow };
      }

      setCurrentLap(newLap);
    }

    if (typeof telemetry.fuel === 'number' && Number.isFinite(telemetry.fuel) && telemetry.fuel >= 0) {
      setCurrentFuel(roundTo(telemetry.fuel, 1));
    }

    // 実測燃費の履歴がまだ無い(接続直後・レース序盤)場合のみ、ブリッジ側の累積推定値で代用する
    if (
      lapFuelHistoryRef.current.length === 0 &&
      typeof telemetry.fuelPerLap === 'number' && Number.isFinite(telemetry.fuelPerLap) && telemetry.fuelPerLap > 0
    ) {
      setFuelPerLap(roundTo(telemetry.fuelPerLap, 2));
    }

    if (typeof telemetry.maxFuel === 'number' && Number.isFinite(telemetry.maxFuel) && telemetry.maxFuel > 0) {
      setTankCapacity(roundTo(telemetry.maxFuel, 1));
    }

    if (typeof telemetry.rainIntensity === 'number' && Number.isFinite(telemetry.rainIntensity)) {
      setIsRaining(telemetry.rainIntensity > 0);
    }
  }, []);

  const confirmPitAsMandatory = useCallback(() => {
    setCompletedMandatoryPits(prev => (Number(prev) || 0) + 1);
    setPitExitPrompt(null);
  }, []);

  const dismissPitPrompt = useCallback(() => {
    setPitExitPrompt(null);
  }, []);

  const connectAccBridge = useCallback(() => {
    disconnectAccBridge();
    accBridgeManualDisconnectRef.current = false;
    setAccBridgeStatus('connecting');
    setAccBridgeErrorMsg('');

    try {
      const socket = new WebSocket(accBridgeUrl);
      accBridgeSocketRef.current = socket;

      socket.onopen = () => {
        localStorage.setItem('acc-bridge-url', accBridgeUrl);
        setAccBridgeStatus('connected');
        setIsAccBridgeModalOpen(false);
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as AccBridgeFrame | AccBridgeTelemetry;
          const telemetry = 'telemetry' in parsed && parsed.telemetry ? parsed.telemetry : parsed as AccBridgeTelemetry;
          applyAccBridgeTelemetry(telemetry);
        } catch (error) {
          console.error('ACC Bridge parse error:', error);
        }
      };

      socket.onerror = () => {
        setAccBridgeStatus('error');
        setAccBridgeErrorMsg('ACC Bridge に接続できません。C++ ブリッジを起動して URL を確認してください。');
      };

      socket.onclose = () => {
        if (accBridgeSocketRef.current === socket) {
          accBridgeSocketRef.current = null;
          setAccBridgeStatus((status) => status === 'error' ? 'error' : 'disconnected');
        }

        // 手動切断でなければ3秒後に自動再接続 (acc-app / ACC 再起動待ちに対応)
        if (!accBridgeManualDisconnectRef.current) {
          if (accBridgeReconnectTimerRef.current) clearTimeout(accBridgeReconnectTimerRef.current);
          accBridgeReconnectTimerRef.current = setTimeout(() => {
            connectAccBridgeRef.current();
          }, 3000);
        }
      };
    } catch (error) {
      console.error('ACC Bridge connection error:', error);
      setAccBridgeStatus('error');
      setAccBridgeErrorMsg('WebSocket URL が正しくありません。');
    }
  }, [accBridgeUrl, applyAccBridgeTelemetry, disconnectAccBridge]);

  useEffect(() => {
    connectAccBridgeRef.current = connectAccBridge;
  }, [connectAccBridge]);

  useEffect(() => {
    // 起動時に自動接続。C++ブリッジやACCがまだ起動していなくても3秒おきに自動で再試行する。
    connectAccBridgeRef.current();
    return () => {
      accBridgeManualDisconnectRef.current = true;
      if (accBridgeReconnectTimerRef.current) clearTimeout(accBridgeReconnectTimerRef.current);
      accBridgeSocketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const pollSimHub = async () => {
      try {
        // Fetch properties from SimHub REST API
        // Data structure from GameData: { CurrentLap, Fuel, etc. }
        const res = await fetch(`${simHubUrl}/api/get/GameData`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!res.ok) throw new Error('Failed to fetch data');
        
        const data = await res.json();
        
        // SimHub GameData typically has properties like:
        // CurrentLap, Fuel, IsRaining, etc. depending on the exact game.
        // For ACC, we can also check for specific properties using the specific property API:
        // http://localhost:8888/api/get-property-by-name?name=DataCorePlugin.GameData.CurrentLap
        
        // Let's use the direct property API to get what we need reliably:
        const lapRes = await fetch(`${simHubUrl}/api/get-property-by-name?name=DataCorePlugin.GameData.NewData.CurrentLap`);
        const fuelRes = await fetch(`${simHubUrl}/api/get-property-by-name?name=DataCorePlugin.GameData.NewData.Fuel`);
        // Maybe rain?
        const rainRes = await fetch(`${simHubUrl}/api/get-property-by-name?name=DataCorePlugin.GameData.NewData.TrackTemperature`);
        
        if (lapRes.ok) {
          const lapText = await lapRes.text();
          if (lapText && !isNaN(Number(lapText))) setCurrentLap(Number(lapText));
        }
        
        if (fuelRes.ok) {
          const fuelText = await fuelRes.text();
          if (fuelText && !isNaN(Number(fuelText))) setCurrentFuel(Math.floor(Number(fuelText) * 10) / 10);
        }
        
      } catch (err) {
        console.error("SimHub Polling Error:", err);
        setSimHubStatus('error');
        setSimHubErrorMsg('通信が途絶えました (Connection Lost)');
      }
    };

    if (simHubStatus === 'connected') {
      intervalId = setInterval(pollSimHub, 2000); // 2秒ごとに更新
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [simHubStatus, simHubUrl]);

  const connectSimHub = async (silent = false) => {
    setSimHubStatus('connecting');
    if (!silent) setSimHubErrorMsg('');
    try {
      // Test connection
      const res = await fetch(`${simHubUrl}/api/get-property-by-name?name=DataCorePlugin.GameData.NewData.CurrentLap`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        setSimHubStatus('connected');
        setIsSimHubModalOpen(false);
      } else {
        throw new Error('Invalid response');
      }
    } catch (err) {
      if (!silent) {
        setSimHubStatus('error');
        setSimHubErrorMsg('接続に失敗しました。URLとSimHubの設定を確認してください。');
      } else {
        setSimHubStatus('disconnected');
      }
    }
  };

  useEffect(() => {
    // Auto-connect if hosted on SimHub web server
    if (window.location.port === '8888' || window.location.port === '8889') {
      connectSimHub(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const savePreset = () => {
    if (!newPresetName.trim()) return;
    const newPreset: Preset = {
      id: Date.now().toString(),
      name: newPresetName.trim(),
      raceDuration,
      lapMin,
      lapSec,
      fuelPerLap,
      wetLapMin,
      wetLapSec,
      wetFuelPerLap,
      tankCapacity,
      mandatoryPitStops,
      maxStintTime,
      pitLossTime,
      tireChangeTime,
      refuelTimePerL,
      safetyMarginLaps,
      minReserveFuel,
      tyrePressureMin,
      tyrePressureMax,
      extraLaps,
      strategyType
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    localStorage.setItem('acc-fuel-presets', JSON.stringify(updated));
    setNewPresetName('');
    setShowSavePreset(false);
  };

  const loadPreset = (preset: Preset) => {
    setRaceDuration(preset.raceDuration);
    setLapMin(preset.lapMin);
    setLapSec(preset.lapSec);
    setFuelPerLap(preset.fuelPerLap);
    setWetLapMin(preset.wetLapMin !== undefined ? preset.wetLapMin : '');
    setWetLapSec(preset.wetLapSec !== undefined ? preset.wetLapSec : '');
    setWetFuelPerLap(preset.wetFuelPerLap !== undefined ? preset.wetFuelPerLap : '');
    setTankCapacity(preset.tankCapacity);
    setMandatoryPitStops(preset.mandatoryPitStops);
    setMaxStintTime(preset.maxStintTime !== undefined ? preset.maxStintTime : 65);
    setPitLossTime(preset.pitLossTime !== undefined ? preset.pitLossTime : 30);
    setTireChangeTime(preset.tireChangeTime !== undefined ? preset.tireChangeTime : 30);
    setRefuelTimePerL(preset.refuelTimePerL !== undefined ? preset.refuelTimePerL : 0.2);
    setSafetyMarginLaps(preset.safetyMarginLaps !== undefined ? preset.safetyMarginLaps : 1.0);
    setMinReserveFuel(preset.minReserveFuel !== undefined ? preset.minReserveFuel : 0);
    setTyrePressureMin(preset.tyrePressureMin !== undefined ? preset.tyrePressureMin : 26.5);
    setTyrePressureMax(preset.tyrePressureMax !== undefined ? preset.tyrePressureMax : 27.5);
    setExtraLaps(preset.extraLaps);
    setStrategyType(preset.strategyType || 'equal');
  };

  const deletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    localStorage.setItem('acc-fuel-presets', JSON.stringify(updated));
  };

  const results = useMemo(() => {
    const duration = Number(raceDuration) || 0;
    const min = Number(lapMin) || 0;
    const sec = Number(lapSec) || 0;
    const baseFpl = Number(fuelPerLap) || 0;
    const extra = Number(extraLaps) || 0;
    const tank = Number(tankCapacity) || 110;
    const mandatory = Number(mandatoryPitStops) || 0;
    const stintTimeLimit = Number(maxStintTime) || 0;
    
    const cLap = Number(currentLap) || 0;
    const cFuel = Number(currentFuel) || 0;
    const completedPits = Number(completedMandatoryPits) || 0;

    let lapTimeInSeconds = (min * 60) + sec;
    let fpl = baseFpl;

    if (isRaining) {
      if (wetLapMin !== '' || wetLapSec !== '') {
        lapTimeInSeconds = ((Number(wetLapMin) || 0) * 60) + (Number(wetLapSec) || 0);
      } else {
        lapTimeInSeconds *= 1.15; // 15% slower in wet
      }

      if (wetFuelPerLap !== '') {
        fpl = Number(wetFuelPerLap);
      } else {
        fpl *= 0.92; // 8% less fuel consumption in wet
      }
    }

    if (lapTimeInSeconds <= 0 || duration <= 0 || fpl <= 0) return null;

    const raceDurationInSeconds = duration * 60;
    const rawLaps = raceDurationInSeconds / lapTimeInSeconds;
    
    const raceLaps = Math.ceil(rawLaps);
    const totalLaps = raceLaps + extra;
    const totalFuel = Math.ceil(totalLaps * fpl);

    const isEmergency = cLap > 0 && cLap < totalLaps;

    let lapsToCover = totalLaps;
    let initialFuelInTank = 0;
    let pitsRequired = mandatory;
    
    if (isEmergency) {
      lapsToCover = totalLaps - cLap;
      initialFuelInTank = cFuel;
      pitsRequired = Math.max(0, mandatory - completedPits - (countsAsMandatory ? 1 : 0));
    }

    const totalFuelNeededForCoverage = Math.ceil(lapsToCover * fpl);
    
    let maxLapsPerStint = lapsToCover;
    if (tank > 0 && fpl > 0) {
      maxLapsPerStint = Math.min(maxLapsPerStint, Math.floor(tank / fpl));
    }
    if (stintTimeLimit > 0) {
      const maxLapsByTime = Math.floor((stintTimeLimit * 60) / lapTimeInSeconds);
      maxLapsPerStint = Math.min(maxLapsPerStint, maxLapsByTime);
    }
    
    const minPitsRequiredForLaps = maxLapsPerStint > 0 ? Math.max(0, Math.ceil(lapsToCover / maxLapsPerStint) - 1) : 0;
    const totalPits = Math.max(minPitsRequiredForLaps, pitsRequired);
    const totalStints = totalPits + 1;

    const stints: { 
      label: string; 
      addedFuel: number; 
      targetFuelInTank: number; 
      laps: number; 
      isEmergencyStart?: boolean; 
      pitTimeElapsed: string;
      startLap: number;
      endLap: number;
      pitStationaryTime: number;
      pitTotalTime: number;
    }[] = [];
    
    let remainingLaps = lapsToCover;
    let cumulativeStintLaps = isEmergency ? cLap : 0;
    
    const pLoss = Number(pitLossTime) || 30;
    const tTime = Number(tireChangeTime) || 30;
    const rTime = Number(refuelTimePerL) || 0.2;
    
    if (strategyType === 'equal') {
      const baseLaps = Math.floor(lapsToCover / totalStints);
      const remainderLaps = lapsToCover % totalStints;
      
      let currentTank = initialFuelInTank;

      for (let i = 0; i < totalStints; i++) {
        const lapsForStint = baseLaps + (i < remainderLaps ? 1 : 0);
        const fuelConsumedThisStint = Math.ceil(lapsForStint * fpl);
        
        let targetFuelInTank = fuelConsumedThisStint;
        targetFuelInTank = Math.max(targetFuelInTank, currentTank);
        targetFuelInTank = Math.min(targetFuelInTank, tank);
        
        const addedFuel = Math.max(0, targetFuelInTank - currentTank);
        
        // Pit time calc
        let pitStationaryTime = 0;
        let pitTotalTime = 0;
        if (i === 0 && isEmergency) {
          pitStationaryTime = Math.max(tTime, addedFuel * rTime);
          pitTotalTime = pLoss + pitStationaryTime;
        } else if (i > 0) {
          pitStationaryTime = Math.max(tTime, addedFuel * rTime);
          pitTotalTime = pLoss + pitStationaryTime;
        }
        
        cumulativeStintLaps += lapsForStint;
        const estimatedTimeSec = cumulativeStintLaps * lapTimeInSeconds;
        const estMin = Math.floor(estimatedTimeSec / 60);
        const estSec = Math.floor(estimatedTimeSec % 60);
        const formattedTime = (i === totalStints - 1) ? 'フィニッシュ' : `${estMin}:${estSec.toString().padStart(2, '0')} 経過`;

        let startLap = 0;
        let endLap = 0;
        let pitEntryLap = 0;
        if (i === 0) {
          startLap = isEmergency ? cLap + 1 : 1;
          endLap = isEmergency ? cLap + lapsForStint : lapsForStint;
          pitEntryLap = isEmergency ? cLap : 0;
        } else {
          startLap = stints[i - 1].endLap + 1;
          endLap = stints[i - 1].endLap + lapsForStint;
          pitEntryLap = stints[i - 1].endLap;
        }

        let label = '';
        if (i === 0) {
          label = isEmergency ? `緊急ピット作業 (Lap ${pitEntryLap})` : 'スタート (Start)';
        } else {
          label = `ピット ${i} 作業 (Lap ${pitEntryLap})`;
        }

        stints.push({
          label,
          addedFuel,
          targetFuelInTank,
          laps: lapsForStint,
          isEmergencyStart: isEmergency && i === 0,
          pitTimeElapsed: formattedTime,
          startLap,
          endLap,
          pitStationaryTime,
          pitTotalTime
        });
        
        currentTank = targetFuelInTank - fuelConsumedThisStint;
      }
    } else {
      let currentTank = initialFuelInTank;
      
      for (let i = 0; i < totalStints; i++) {
        let lapsForStint = 0;
        let addedFuel = 0;
        let targetFuelInTank = 0;
        
        if (i === totalStints - 1) {
          lapsForStint = remainingLaps;
          targetFuelInTank = Math.ceil(lapsForStint * fpl);
          targetFuelInTank = Math.max(targetFuelInTank, currentTank);
          targetFuelInTank = Math.min(targetFuelInTank, tank);
          addedFuel = Math.max(0, targetFuelInTank - currentTank);
          targetFuelInTank = currentTank + addedFuel;
        } else {
          let maxLapsPossible = Math.floor(tank / fpl);
          if (stintTimeLimit > 0) {
            const maxLapsByTime = Math.floor((stintTimeLimit * 60) / lapTimeInSeconds);
            maxLapsPossible = Math.min(maxLapsPossible, maxLapsByTime);
          }
          
          lapsForStint = Math.min(maxLapsPossible, remainingLaps - (totalStints - 1 - i));
          if (lapsForStint <= 0) lapsForStint = 1;
          
          targetFuelInTank = Math.min(tank, Math.ceil(lapsForStint * fpl));
          addedFuel = Math.max(0, targetFuelInTank - currentTank);
        }

        let pitStationaryTime = 0;
        let pitTotalTime = 0;
        if (i === 0 && isEmergency) {
          pitStationaryTime = Math.max(tTime, addedFuel * rTime);
          pitTotalTime = pLoss + pitStationaryTime;
        } else if (i > 0) {
          pitStationaryTime = Math.max(tTime, addedFuel * rTime);
          pitTotalTime = pLoss + pitStationaryTime;
        }

        cumulativeStintLaps += lapsForStint;
        const estimatedTimeSec = cumulativeStintLaps * lapTimeInSeconds;
        const estMin = Math.floor(estimatedTimeSec / 60);
        const estSec = Math.floor(estimatedTimeSec % 60);
        const formattedTime = (i === totalStints - 1) ? 'フィニッシュ' : `${estMin}:${estSec.toString().padStart(2, '0')} 経過`;

        let startLap = 0;
        let endLap = 0;
        let pitEntryLap = 0;
        if (i === 0) {
          startLap = isEmergency ? cLap + 1 : 1;
          endLap = isEmergency ? cLap + lapsForStint : lapsForStint;
          pitEntryLap = isEmergency ? cLap : 0;
        } else {
          startLap = stints[i - 1].endLap + 1;
          endLap = stints[i - 1].endLap + lapsForStint;
          pitEntryLap = stints[i - 1].endLap;
        }

        let label = '';
        if (i === 0) {
          label = isEmergency ? `緊急ピット作業 (Lap ${pitEntryLap})` : 'スタート (Start)';
        } else {
          label = `ピット ${i} 作業 (Lap ${pitEntryLap})`;
        }

        stints.push({
          label,
          addedFuel,
          targetFuelInTank,
          laps: lapsForStint,
          isEmergencyStart: isEmergency && i === 0,
          pitTimeElapsed: formattedTime,
          startLap,
          endLap,
          pitStationaryTime,
          pitTotalTime
        });
        
        const fuelConsumedThisStint = Math.ceil(lapsForStint * fpl);
        currentTank = targetFuelInTank - fuelConsumedThisStint;
        remainingLaps -= lapsForStint;
      }
    }

    const pitStopsTiming = [];
    let cumulativeLaps = isEmergency ? cLap : 0;
    
    for (let i = 0; i < stints.length - 1; i++) {
      cumulativeLaps += stints[i].laps;
      
      const undercutStart = Math.max(isEmergency ? cLap + 1 : 1, cumulativeLaps - 2);
      const undercutEnd = Math.max(isEmergency ? cLap + 1 : 1, cumulativeLaps - 1);
      
      const overcutStart = Math.min(totalLaps - 1, cumulativeLaps + 1);
      const overcutEnd = Math.min(totalLaps - 1, cumulativeLaps + 2);

      pitStopsTiming.push({
        stopNumber: i + 1,
        targetLap: cumulativeLaps,
        undercutStart,
        undercutEnd,
        overcutStart,
        overcutEnd,
        canUndercut: undercutEnd < cumulativeLaps && undercutStart >= (isEmergency ? cLap + 1 : 1),
        canOvercut: overcutStart > cumulativeLaps && overcutEnd < totalLaps
      });
    }

    let brakePadRecommendation = 1;
    const raceDurationMins = Number(raceDuration) || 0;
    if (isRaining) {
      brakePadRecommendation = 3;
    } else if (raceDurationMins <= 180) { // Up to 3 hours
      brakePadRecommendation = 1;
    } else if (raceDurationMins <= 720) { // Up to 12 hours
      brakePadRecommendation = 2;
    } else { // Over 12 hours
      brakePadRecommendation = 3;
    }

    return {
      isEmergency,
      isRaining,
      totalLaps,
      lapsToCover,
      totalFuel,
      totalFuelNeededForCoverage,
      totalPits,
      stints,
      pitStopsTiming,
      rawLaps,
      brakePadRecommendation
    };
  }, [
    raceDuration,
    lapMin,
    lapSec,
    fuelPerLap,
    extraLaps,
    wetLapMin,
    wetLapSec,
    wetFuelPerLap,
    tankCapacity,
    mandatoryPitStops,
    maxStintTime,
    strategyType,
    pitLossTime,
    tireChangeTime,
    refuelTimePerL,
    currentLap,
    currentFuel,
    completedMandatoryPits,
    countsAsMandatory,
    isRaining
  ]);

  // Fuel Engine: 現在のFuel/Fuel per Lapから「今すぐ使える情報」だけを算出する軽量レイヤー。
  // results(スティント計画全体)とは別に、ライブ運用中に一目で見たい数値だけを独立して持たせる。
  const fuelEngine = useMemo(() => {
    const fuel = Number(currentFuel);
    const fpl = Number(fuelPerLap);
    if (!(fuel > 0) || !(fpl > 0)) return null;

    const reserve = Math.max(0, Number(minReserveFuel) || 0);
    const usableFuel = Math.max(0, fuel - reserve); // 最低残燃料を除いた「使える」燃料
    const remainingLaps = usableFuel / fpl; // 今の燃料(予備を除く)で走れる周回数
    const lapsToFinish = results.isEmergency ? results.lapsToCover : null; // フィニッシュまでの残り周回数
    const margin = lapsToFinish !== null ? remainingLaps - lapsToFinish : null; // 燃費余裕(+なら足りる)
    const marginThreshold = Number(safetyMarginLaps) || 0;
    const isLow = alertsEnabled && margin !== null && margin < marginThreshold;
    const refuelNeeded = lapsToFinish !== null
      ? Math.max(0, (results.totalFuelNeededForCoverage + reserve) - fuel)
      : null;

    return { fuel, fpl, remainingLaps, lapsToFinish, margin, refuelNeeded, isLow, marginThreshold };
  }, [currentFuel, fuelPerLap, results, minReserveFuel, safetyMarginLaps, alertsEnabled]);

  // Weather Engine: trackGripStatus(0-6: Green/Fast/Optimum/Greasy/Damp/Wet/Flooded)を
  // Dry/Damp/Wet/Heavy Wetの4段階に単純化し、ACCが持つ10分/30分先の雨量予報からトレンドを出す。
  const weatherEngine = useMemo(() => {
    const t = accBridgeTelemetry;
    if (!t || t.connected === false || typeof t.trackGripStatus !== 'number') return null;

    const gripIndex = Math.max(0, Math.min(6, Math.round(t.trackGripStatus)));
    const gripLabel = TRACK_GRIP_LABELS[gripIndex] ?? '不明';

    let condition: 'Dry' | 'Damp' | 'Wet' | 'Heavy Wet';
    if (gripIndex <= 2) condition = 'Dry';
    else if (gripIndex <= 4) condition = 'Damp';
    else if (gripIndex === 5) condition = 'Wet';
    else condition = 'Heavy Wet';

    const now = typeof t.rainIntensity === 'number' ? t.rainIntensity : null;
    const in10 = typeof t.rainIntensityIn10min === 'number' ? t.rainIntensityIn10min : null;
    const in30 = typeof t.rainIntensityIn30min === 'number' ? t.rainIntensityIn30min : null;

    let trend: 'increasing' | 'drying' | 'steady' | null = null;
    if (now !== null && in10 !== null) {
      if (in10 > now) trend = 'increasing';
      else if (in10 < now) trend = 'drying';
      else trend = 'steady';
    }

    return {
      gripIndex,
      gripLabel,
      condition,
      rainNow: now,
      rainIn10: in10,
      rainIn30: in30,
      trend,
      roadTemp: typeof t.roadTemp === 'number' ? t.roadTemp : null,
    };
  }, [accBridgeTelemetry]);

  // Race Control: ACCのflag(0-6)を、そのまま「今すべきこと」に翻訳する。
  const raceControl = useMemo(() => {
    const t = accBridgeTelemetry;
    if (!t || t.connected === false || typeof t.flag !== 'number') return null;
    const info = FLAG_INFO[t.flag] ?? { label: `不明 (${t.flag})`, advice: '', tone: 'neutral' as const };
    return { flag: t.flag, ...info };
  }, [accBridgeTelemetry]);

  // Tyre Engine: 4輪の空気圧・摩耗・温度を判定し、最も状態の悪いコーナーで全体ステータスを決める
  const tyreEngine = useMemo(() => {
    const t = accBridgeTelemetry;
    if (!t || t.connected === false || !Array.isArray(t.tyrePressure) || !Array.isArray(t.tyreTemp) || !Array.isArray(t.tyreWear)) {
      return null;
    }
    const pMin = Number(tyrePressureMin) || 0;
    const pMax = Number(tyrePressureMax) || Infinity;

    const corners = TYRE_LABELS.map((label, i) => {
      const pressure = t.tyrePressure?.[i] ?? 0;
      const temp = t.tyreTemp?.[i] ?? 0;
      const wear = t.tyreWear?.[i] ?? 0;

      let status: 'Optimal' | 'Cold' | 'Overheated' | 'Replace' = 'Optimal';
      if (wear >= TYRE_WEAR_REPLACE) status = 'Replace';
      else if (temp > TYRE_TEMP_HOT_MAX) status = 'Overheated';
      else if (temp < TYRE_TEMP_COLD_MAX) status = 'Cold';
      else if (pressure < pMin || pressure > pMax) status = 'Cold'; // 圧力レンジ外れも要注意扱い

      return { label, pressure, temp, wear, status };
    });

    const severity = { Optimal: 0, Cold: 1, Overheated: 2, Replace: 3 } as const;
    const worst = corners.reduce((a, b) => (severity[b.status] > severity[a.status] ? b : a));

    return { corners, overallStatus: worst.status, wearCaution: corners.some(c => c.wear >= TYRE_WEAR_CAUTION) };
  }, [accBridgeTelemetry, tyrePressureMin, tyrePressureMax]);

  // Session Engine
  const sessionEngine = useMemo(() => {
    const t = accBridgeTelemetry;
    if (!t || t.connected === false || typeof t.sessionType !== 'number') return null;
    const label = SESSION_TYPE_LABELS[t.sessionType] ?? `Unknown(${t.sessionType})`;
    const timeLeftSec = typeof t.sessionTimeLeft === 'number' ? Math.max(0, Math.round(t.sessionTimeLeft)) : null;
    const mm = timeLeftSec !== null ? Math.floor(timeLeftSec / 60) : null;
    const ss = timeLeftSec !== null ? timeLeftSec % 60 : null;
    return {
      label,
      timeLeftSec,
      timeLeftDisplay: mm !== null && ss !== null ? `${mm}:${String(ss).padStart(2, '0')}` : null,
      numberOfLaps: typeof t.numberOfLaps === 'number' && t.numberOfLaps > 0 ? t.numberOfLaps : null,
    };
  }, [accBridgeTelemetry]);

  const renderEmergencyInput = () => (
    <div className={`bg-gradient-to-br from-slate-900 to-slate-950 border ${isSimpleMode ? 'border-yellow-900/40 p-4' : 'border-slate-800 p-6'} rounded-2xl shadow-xl space-y-4 relative overflow-hidden`}>
      {isSimpleMode && <div className="absolute top-0 left-0 w-1 h-full bg-yellow-500"></div>}
      <h2 className={`text-sm sm:text-base font-bold flex items-center ${isSimpleMode ? 'text-yellow-400' : 'text-white'}`}>
        <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-yellow-500" />
        レース中再計算 (Live Update: 雨・アンダーカット・ダメージ等)
      </h2>
      <p className="text-xs text-slate-400 mb-2">
        イレギュラーなピットインが発生した際、ピットイン直前の情報を入力することで、残りのレース戦略を瞬時に再計算します。
      </p>
      
      <div className={`grid grid-cols-2 ${isSimpleMode ? 'lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-4'} gap-3 sm:gap-4`}>
        <div className="space-y-1">
          <label className="flex items-center text-xs sm:text-sm font-semibold text-slate-300">
            現在の周回数 (Lap)
          </label>
          <div className="flex bg-slate-950 border border-slate-700 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-yellow-500 transition-all shadow-inner">
            <button 
              onClick={() => setCurrentLap(prev => (Number(prev) || 1) > 1 ? (Number(prev) || 1) - 1 : 1)}
              className="px-4 bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-black text-lg border-r border-slate-700 transition-colors"
            >-</button>
            <input
              type="number"
              min="1"
              value={currentLap}
              onChange={(e) => setCurrentLap(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-transparent py-2 px-1 sm:py-3 text-center text-sm sm:text-base text-white font-mono font-bold focus:outline-none"
              placeholder="例: 15"
            />
            <button 
              onClick={() => setCurrentLap(prev => (Number(prev) || 0) + 1)}
              className="px-4 bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-black text-lg border-l border-slate-700 transition-colors"
            >+</button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="flex items-center text-xs sm:text-sm font-semibold text-slate-300">
            現在の残燃料 (Fuel)
          </label>
          <div className="flex bg-slate-950 border border-slate-700 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-yellow-500 transition-all shadow-inner">
            <button 
              onClick={() => setCurrentFuel(prev => (Number(prev) || 5) > 5 ? (Number(prev) || 5) - 5 : 0)}
              className="px-3 bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-black text-sm border-r border-slate-700 transition-colors"
            >-5</button>
            <div className="relative w-full">
              <input
                type="number"
                min="0"
                value={currentFuel}
                onChange={(e) => setCurrentFuel(e.target.value ? Number(e.target.value) : '')}
                className="w-full h-full bg-transparent py-2 px-1 sm:py-3 text-center text-sm sm:text-base text-white font-mono font-bold focus:outline-none"
                placeholder="任意"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium pointer-events-none">L</span>
            </div>
            <button 
              onClick={() => setCurrentFuel(prev => (Number(prev) || 0) + 5)}
              className="px-3 bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-black text-sm border-l border-slate-700 transition-colors"
            >+5</button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="flex items-center text-xs sm:text-sm font-semibold text-slate-300">
            消化済み義務ピット
          </label>
          <div className="flex bg-slate-950 border border-slate-700 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-yellow-500 transition-all shadow-inner">
            <button 
              onClick={() => setCompletedMandatoryPits(prev => (Number(prev) || 1) > 1 ? (Number(prev) || 1) - 1 : 0)}
              className="px-4 bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-black text-lg border-r border-slate-700 transition-colors"
            >-</button>
            <div className="relative w-full">
              <input
                type="number"
                min="0"
                value={completedMandatoryPits}
                onChange={(e) => setCompletedMandatoryPits(e.target.value ? Number(e.target.value) : '')}
                className="w-full h-full bg-transparent py-2 px-1 sm:py-3 text-center text-sm sm:text-base text-white font-mono font-bold focus:outline-none"
                placeholder="例: 0"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-medium pointer-events-none">回</span>
            </div>
            <button 
              onClick={() => setCompletedMandatoryPits(prev => (Number(prev) || 0) + 1)}
              className="px-4 bg-slate-800/80 hover:bg-slate-700 text-slate-300 font-black text-lg border-l border-slate-700 transition-colors"
            >+</button>
          </div>
        </div>

        <div className="col-span-1 flex flex-col justify-end pb-1.5 sm:pb-3">
          <label className="flex items-center space-x-2 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={countsAsMandatory}
              onChange={(e) => setCountsAsMandatory(e.target.checked)}
              className="w-4.5 h-4.5 rounded border-slate-700 text-yellow-500 focus:ring-yellow-500 bg-slate-950"
            />
            <span className="text-xs sm:text-sm font-semibold text-slate-300 whitespace-nowrap">
              今回義務消化する
            </span>
          </label>
        </div>

        <div className={`col-span-2 ${isSimpleMode ? 'lg:col-span-4' : 'sm:col-span-2 lg:col-span-4'} flex flex-col justify-end`}>
          <button
            onClick={() => setIsRaining(!isRaining)}
            className={`w-full flex items-center justify-center space-x-2 py-3 rounded-xl text-sm font-bold transition-all ${
              isRaining
                ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.5)] border-blue-500'
                : 'bg-slate-900 border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <CloudRain className={`w-5 h-5 ${isRaining ? 'text-white' : 'text-slate-400'}`} />
            <span>{isRaining ? 'ウェット戦略中 (Rain Strategy Active)' : '雨天戦略に切り替え (Switch to Wet Strategy)'}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-950 text-slate-200 font-sans ${isSimpleMode ? 'p-1.5 sm:p-4' : 'p-3 sm:p-8'}`}>
      <div className={`${isSimpleMode ? 'max-w-full space-y-2.5' : 'max-w-5xl space-y-4 sm:space-y-6'} mx-auto transition-all duration-300`}>
        {/* Header */}
        <header className={`flex items-center justify-between ${isSimpleMode ? 'mb-1 sm:mb-4' : 'mb-4 sm:mb-8'}`}>
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className={`p-1.5 sm:p-3 bg-red-600 rounded-lg ${isSimpleMode ? 'hidden sm:block' : ''}`}>
              <Calculator className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h1 className={`font-bold text-white tracking-tight ${isSimpleMode ? 'text-sm sm:text-2xl' : 'text-lg sm:text-2xl'}`}>
                {isSimpleMode ? 'ACC Fuel & Pit (Race Mode)' : 'ACC Fuel & Pit Strategy Planner'}
              </h1>
              {!isSimpleMode && <p className="text-slate-400 text-[10px] sm:text-sm">Assetto Corsa Competizione レース戦略計算ツール</p>}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsAccBridgeModalOpen(true)}
              className={`flex items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-medium transition-all border ${
                accBridgeStatus === 'connected'
                  ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                  : accBridgeStatus === 'error'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <div className={`w-2 h-2 rounded-full mr-1.5 sm:mr-2 ${
                accBridgeStatus === 'connected' ? 'bg-red-400 animate-pulse' :
                accBridgeStatus === 'error' ? 'bg-amber-400' : 'bg-slate-500'
              }`}></div>
              <span className="hidden sm:inline">
                {accBridgeStatus === 'connected' ? 'ACC Bridge 連携中' :
                 accBridgeStatus === 'error' ? 'ACC Bridge エラー' : 'ACC Bridge'}
              </span>
              <span className="sm:hidden">
                {accBridgeStatus === 'connected' ? 'ACC ON' :
                 accBridgeStatus === 'error' ? 'ACC ERR' : 'ACC'}
              </span>
            </button>
            <button
              onClick={() => setIsSimHubModalOpen(true)}
              className={`flex items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-medium transition-all border ${
                simHubStatus === 'connected' 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                  : simHubStatus === 'error'
                  ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              <div className={`w-2 h-2 rounded-full mr-1.5 sm:mr-2 ${
                simHubStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 
                simHubStatus === 'error' ? 'bg-red-400' : 'bg-slate-500'
              }`}></div>
              <span className="hidden sm:inline">
                {simHubStatus === 'connected' ? 'SimHub 連携中' : 
                 simHubStatus === 'error' ? 'SimHub エラー' : 'SimHub 連携'}
              </span>
              <span className="sm:hidden">
                {simHubStatus === 'connected' ? 'SimHub ON' : 
                 simHubStatus === 'error' ? 'SimHub ERR' : 'SimHub'}
              </span>
            </button>
            <button
              onClick={() => setIsSimpleMode(!isSimpleMode)}
              className={`flex items-center px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all ${
                isSimpleMode 
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30' 
                  : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {isSimpleMode ? (
                <>
                  <Minimize className="w-3.5 h-3.5 mr-1.5" />
                  <span className="hidden sm:inline">通常モードに戻る</span>
                  <span className="sm:hidden">通常</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  <span className="hidden sm:inline">レース中モード</span>
                  <span className="sm:hidden">レース</span>
                </>
              )}
            </button>
          </div>
        </header>

        {pitExitPrompt && (
          <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-2xl p-4 mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-100">
                <p className="font-bold text-yellow-400">ピット退出を検知しました{pitExitPrompt.lap !== '' ? `(Lap ${pitExitPrompt.lap})` : ''}</p>
                <p className="text-xs text-yellow-200/80 mt-0.5">
                  {pitExitPrompt.fuel !== '' ? `退出時燃料: ${pitExitPrompt.fuel}L / ` : ''}
                  今のピットは義務ピットストップとしてカウントしますか？
                </p>
              </div>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={confirmPitAsMandatory}
                className="flex-1 sm:flex-none bg-yellow-500 hover:bg-yellow-400 text-slate-900 text-sm font-bold px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
              >
                義務ピットとしてカウント
              </button>
              <button
                onClick={dismissPitPrompt}
                className="flex-1 sm:flex-none bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
              >
                カウントしない
              </button>
            </div>
          </div>
        )}

        {fuelEngine && (
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center">
                <Fuel className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-emerald-400" />
                Fuel Engine
              </h2>
              {accBridgeStatus === 'connected' && (
                <span className="flex items-center text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1"></span>
                  LIVE
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
              <div className="bg-slate-950/60 rounded-xl p-3">
                <div className="text-[11px] text-slate-500 mb-1">Fuel</div>
                <div className="text-lg sm:text-2xl font-black text-white truncate">
                  {fuelEngine.fuel.toFixed(1)}<span className="text-xs sm:text-sm text-slate-500 ml-0.5">L</span>
                </div>
              </div>
              <div className="bg-slate-950/60 rounded-xl p-3">
                <div className="text-[11px] text-slate-500 mb-1">Fuel/Lap</div>
                <div className="text-lg sm:text-2xl font-black text-white truncate">
                  {fuelEngine.fpl.toFixed(2)}<span className="text-xs sm:text-sm text-slate-500 ml-0.5">L</span>
                </div>
              </div>
              <div className="bg-slate-950/60 rounded-xl p-3">
                <div className="text-[11px] text-slate-500 mb-1">Remaining</div>
                <div className="text-lg sm:text-2xl font-black text-white truncate">
                  {fuelEngine.remainingLaps.toFixed(2)}<span className="text-xs sm:text-sm text-slate-500 ml-0.5">Lap</span>
                </div>
              </div>
              {fuelEngine.lapsToFinish !== null ? (
                <div className="bg-slate-950/60 rounded-xl p-3">
                  <div className="text-[11px] text-slate-500 mb-1">Finish</div>
                  <div className="text-lg sm:text-2xl font-black text-white truncate">
                    {fuelEngine.lapsToFinish}<span className="text-xs sm:text-sm text-slate-500 ml-0.5">Lap</span>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950/60 rounded-xl p-3 flex items-center justify-center text-center">
                  <div className="text-[11px] text-slate-600">Lap未検出</div>
                </div>
              )}
              {fuelEngine.margin !== null ? (
                <div className={`rounded-xl p-3 border ${fuelEngine.isLow ? 'bg-red-500/10 border-red-500/40' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                  <div className={`text-[11px] mb-1 ${fuelEngine.isLow ? 'text-red-400' : 'text-emerald-400'}`}>Margin</div>
                  <div className={`text-lg sm:text-2xl font-black truncate ${fuelEngine.isLow ? 'text-red-400' : 'text-emerald-400'}`}>
                    {fuelEngine.margin >= 0 ? '+' : ''}{fuelEngine.margin.toFixed(2)}<span className="text-xs sm:text-sm ml-0.5 opacity-70">Lap</span>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950/60 rounded-xl p-3 flex items-center justify-center text-center">
                  <div className="text-[11px] text-slate-600">Lap未検出</div>
                </div>
              )}
            </div>
            {fuelEngine.isLow && fuelEngine.margin !== null && (
              <div className="mt-3 bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-red-400 text-xs sm:text-sm font-bold flex items-start sm:items-center">
                <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5 sm:mt-0" />
                <span>
                  {fuelEngine.margin < 0
                    ? `現在の燃費のままではフィニッシュまで燃料が持ちません(${Math.abs(fuelEngine.margin).toFixed(2)}Lap不足)。`
                    : `安全マージン(${fuelEngine.marginThreshold.toFixed(1)}Lap)を下回っています(残り${fuelEngine.margin.toFixed(2)}Lap分)。`}
                  {fuelEngine.refuelNeeded ? `次のピットで最低 ${Math.ceil(fuelEngine.refuelNeeded)}L の給油が必要です。` : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {(weatherEngine || raceControl) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 sm:mb-6">
            {weatherEngine && (
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center">
                    <CloudRain className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-sky-400" />
                    Weather Engine
                  </h2>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    weatherEngine.condition === 'Dry' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
                    weatherEngine.condition === 'Damp' ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' :
                    weatherEngine.condition === 'Wet' ? 'text-orange-400 border-orange-500/30 bg-orange-500/10' :
                    'text-red-400 border-red-500/30 bg-red-500/10'
                  }`}>
                    {weatherEngine.condition}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-slate-950/60 rounded-xl p-2.5">
                    <div className="text-[11px] text-slate-500">Track Grip</div>
                    <div className="text-white font-bold">{weatherEngine.gripLabel}</div>
                  </div>
                  <div className="bg-slate-950/60 rounded-xl p-2.5">
                    <div className="text-[11px] text-slate-500">Road Temp</div>
                    <div className="text-white font-bold">{weatherEngine.roadTemp !== null ? `${weatherEngine.roadTemp.toFixed(1)}°C` : '-'}</div>
                  </div>
                </div>
                {weatherEngine.trend && (
                  <div className={`mt-2 text-xs font-medium flex items-center gap-1 ${
                    weatherEngine.trend === 'increasing' ? 'text-red-400' :
                    weatherEngine.trend === 'drying' ? 'text-emerald-400' : 'text-slate-400'
                  }`}>
                    {weatherEngine.trend === 'increasing' && <>▲ Rain Increasing (10分後の予報が悪化)</>}
                    {weatherEngine.trend === 'drying' && <>▼ Drying (10分後の予報が回復)</>}
                    {weatherEngine.trend === 'steady' && <>→ Steady</>}
                  </div>
                )}
              </div>
            )}

            {raceControl && (
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-6">
                <h2 className="text-sm sm:text-base font-bold text-white flex items-center mb-3">
                  <Flag className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-slate-400" />
                  Race Control
                </h2>
                <div className={`rounded-xl p-3 border ${
                  raceControl.tone === 'danger' ? 'bg-red-500/10 border-red-500/40' :
                  raceControl.tone === 'caution' ? 'bg-yellow-500/10 border-yellow-500/40' :
                  raceControl.tone === 'info' ? 'bg-blue-500/10 border-blue-500/40' :
                  'bg-slate-950/60 border-slate-800'
                }`}>
                  <div className={`font-bold text-sm sm:text-base ${
                    raceControl.tone === 'danger' ? 'text-red-400' :
                    raceControl.tone === 'caution' ? 'text-yellow-400' :
                    raceControl.tone === 'info' ? 'text-blue-400' : 'text-white'
                  }`}>
                    {raceControl.label}
                  </div>
                  {raceControl.advice && (
                    <div className="text-xs sm:text-sm text-slate-300 mt-1">{raceControl.advice}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {(tyreEngine || sessionEngine) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 sm:mb-6">
            {tyreEngine && (
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center">
                    <Gauge className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-purple-400" />
                    Tyre Engine
                  </h2>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    tyreEngine.overallStatus === 'Optimal' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
                    tyreEngine.overallStatus === 'Replace' ? 'text-red-400 border-red-500/30 bg-red-500/10' :
                    'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'
                  }`}>
                    {tyreEngine.overallStatus}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {tyreEngine.corners.map((c) => (
                    <div key={c.label} className="bg-slate-950/60 rounded-xl p-2 text-center">
                      <div className="text-[11px] text-slate-500 mb-1">{c.label}</div>
                      <div className={`text-sm font-bold ${
                        c.status === 'Optimal' ? 'text-emerald-400' :
                        c.status === 'Replace' ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        {c.temp.toFixed(0)}°C
                      </div>
                      <div className="text-[10px] text-slate-500">{c.pressure.toFixed(1)}psi</div>
                      <div className="text-[10px] text-slate-500">摩耗 {c.wear.toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
                {tyreEngine.wearCaution && (
                  <p className="text-[11px] text-yellow-400 mt-2">摩耗が進んでいるタイヤがあります(目安{TYRE_WEAR_CAUTION}%以上)。</p>
                )}
              </div>
            )}

            {sessionEngine && (
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 sm:p-6">
                <h2 className="text-sm sm:text-base font-bold text-white flex items-center mb-3">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5 mr-2 text-slate-400" />
                  Session Engine
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-950/60 rounded-xl p-2.5">
                    <div className="text-[11px] text-slate-500">Session</div>
                    <div className="text-white font-bold">{sessionEngine.label}</div>
                  </div>
                  <div className="bg-slate-950/60 rounded-xl p-2.5">
                    <div className="text-[11px] text-slate-500">残り時間</div>
                    <div className="text-white font-bold font-mono">{sessionEngine.timeLeftDisplay ?? '-'}</div>
                  </div>
                </div>
                {sessionEngine.numberOfLaps && (
                  <p className="text-[11px] text-slate-400 mt-2">周回数ベースのセッション: 全{sessionEngine.numberOfLaps}周</p>
                )}
              </div>
            )}
          </div>
        )}

        {!isSimpleMode && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-3 sm:p-6 mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-slate-300 w-full sm:w-auto">
              <div className="flex items-center space-x-1">
                <Bookmark className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-xs sm:text-sm">プリセット:</span>
              </div>
              {presets.length > 0 ? (
                <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full sm:max-w-md scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                  {presets.map(p => (
                    <button
                      key={p.id}
                      onClick={() => loadPreset(p)}
                      className="group flex items-center bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-2 py-1 text-xs whitespace-nowrap transition-colors"
                    >
                      <span>{p.name}</span>
                      <X 
                        className="w-3 h-3 ml-1.5 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" 
                        onClick={(e) => deletePreset(p.id, e)}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-slate-500 text-xs sm:text-sm">保存された設定はありません</span>
              )}
            </div>
            
            <div className="w-full sm:w-auto flex-shrink-0">
              {showSavePreset ? (
                <div className="flex items-center space-x-2 w-full justify-between sm:justify-start">
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="プリセット名..."
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-blue-500 flex-grow sm:flex-initial w-32 sm:w-40"
                    autoFocus
                  />
                  <div className="flex space-x-1.5 ml-1.5">
                    <button onClick={savePreset} className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors">
                      保存
                    </button>
                    <button onClick={() => setShowSavePreset(false)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg p-1.5 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowSavePreset(true)}
                  className="flex items-center bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 transition-colors w-full sm:w-auto justify-center"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  現在の設定を保存
                </button>
              )}
            </div>
          </div>
        )}

        <div className={`grid grid-cols-1 ${isSimpleMode ? '' : 'lg:grid-cols-12'} gap-4 sm:gap-6`}>
          {/* Input Form - Hidden in Simple Mode */}
          {!isSimpleMode && (
            <div className="lg:col-span-7 space-y-6">
              {/* Basic Info */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
                <h2 className="text-lg font-semibold text-white flex items-center">
                  <Info className="w-5 h-5 mr-2 text-red-500" />
                  基本設定 (Basic Setup)
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Race Duration */}
                  <div className="space-y-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <Timer className="w-4 h-4 mr-2 text-slate-400" />
                      レース時間 (Race Duration)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        value={raceDuration}
                        onChange={(e) => setRaceDuration(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                      />
                      <span className="absolute right-4 top-3 text-slate-500 font-medium">分 (min)</span>
                    </div>
                  </div>

                  {/* Fuel Per Lap */}
                  <div className="space-y-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <Fuel className="w-4 h-4 mr-2 text-slate-400" />
                      1周の燃料消費量 (Fuel / Lap)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={fuelPerLap}
                        onChange={(e) => setFuelPerLap(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                      />
                      <span className="absolute right-4 top-3 text-slate-500 font-medium">L</span>
                    </div>
                    {lapFuelHistory.length > 0 && (
                      <p className="text-[11px] text-cyan-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                        直近{Math.min(3, lapFuelHistory.length)}周の実測平均を自動反映中 (最新Lap{lapFuelHistory[lapFuelHistory.length - 1].lap}: {lapFuelHistory[lapFuelHistory.length - 1].fuelUsed}L)
                      </p>
                    )}
                  </div>

                  {/* Lap Time */}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <Gauge className="w-4 h-4 mr-2 text-slate-400" />
                      平均ラップタイム (Average Lap Time)
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          value={lapMin}
                          onChange={(e) => setLapMin(e.target.value ? Number(e.target.value) : '')}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                        />
                        <span className="absolute right-4 top-3 text-slate-500 font-medium">分 (m)</span>
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="59.9"
                          value={lapSec}
                          onChange={(e) => setLapSec(e.target.value ? Number(e.target.value) : '')}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                        />
                        <span className="absolute right-4 top-3 text-slate-500 font-medium">秒 (s)</span>
                      </div>
                    </div>
                  </div>

                  {/* Extra Laps */}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <Flag className="w-4 h-4 mr-2 text-slate-400" />
                      予備ラップ (Extra Laps)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        value={extraLaps}
                        onChange={(e) => setExtraLaps(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                      />
                      <span className="absolute right-4 top-3 text-slate-500 font-medium">周 (laps)</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      フォーメーションラップや安全マージンのために追加 (+1〜2推奨)
                    </p>
                  </div>

                  {/* Wet Settings */}
                  <div className="space-y-3 sm:col-span-2 pt-4 border-t border-slate-800">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isRaining}
                        onChange={(e) => setIsRaining(e.target.checked)}
                        className="w-5 h-5 rounded border-slate-700 text-blue-500 focus:ring-blue-500 bg-slate-950"
                      />
                      <span className="text-sm font-bold text-slate-200 flex items-center">
                        <CloudRain className="w-4 h-4 mr-2 text-blue-400" />
                        ウェット戦略を計算に含める (Include Wet Conditions)
                      </span>
                    </label>

                    {isRaining && (
                      <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl mt-3 space-y-4">
                        <p className="text-xs text-slate-400">
                          ※空白の場合は平均データ (タイム+15%、燃料-8%) で計算されます
                        </p>
                        
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-slate-300">ウェット時の平均ラップタイム</label>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="relative">
                              <input
                                type="number"
                                min="0"
                                value={wetLapMin}
                                onChange={(e) => setWetLapMin(e.target.value ? Number(e.target.value) : '')}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm"
                                placeholder="自動"
                              />
                              <span className="absolute right-3 top-2 text-slate-500 text-xs">分</span>
                            </div>
                            <div className="relative">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                max="59.9"
                                value={wetLapSec}
                                onChange={(e) => setWetLapSec(e.target.value ? Number(e.target.value) : '')}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm"
                                placeholder="自動"
                              />
                              <span className="absolute right-3 top-2 text-slate-500 text-xs">秒</span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium text-slate-300">ウェット時の燃料消費量 / 周</label>
                          <div className="relative">
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={wetFuelPerLap}
                              onChange={(e) => setWetFuelPerLap(e.target.value ? Number(e.target.value) : '')}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm"
                              placeholder="自動"
                            />
                            <span className="absolute right-3 top-2 text-slate-500 text-xs">L</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Pit Strategy Info */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
                <h2 className="text-lg font-semibold text-white flex items-center">
                  <Wrench className="w-5 h-5 mr-2 text-blue-500" />
                  ピット戦略設定 (Pit Strategy)
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Tank Capacity */}
                  <div className="space-y-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <Fuel className="w-4 h-4 mr-2 text-slate-400" />
                      燃料タンク容量 (Tank Capacity)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        value={tankCapacity}
                        onChange={(e) => setTankCapacity(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                      <span className="absolute right-4 top-3 text-slate-500 font-medium">L</span>
                    </div>
                  </div>

                  {/* Mandatory Pit Stops */}
                  <div className="space-y-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <ListChecks className="w-4 h-4 mr-2 text-slate-400" />
                      義務ピット回数 (Mandatory Pits)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        value={mandatoryPitStops}
                        onChange={(e) => setMandatoryPitStops(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                      <span className="absolute right-4 top-3 text-slate-500 font-medium">回 (stops)</span>
                    </div>
                  </div>

                  {/* Max Stint Time */}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <Timer className="w-4 h-4 mr-2 text-slate-400" />
                      最大連続運転時間 (Max Stint Time)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        value={maxStintTime}
                        onChange={(e) => setMaxStintTime(e.target.value ? Number(e.target.value) : '')}
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        placeholder="例: 65"
                      />
                      <span className="absolute right-4 top-3 text-slate-500 font-medium">分 (min)</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      ドライバーの最大連続運転時間（設定しない場合は空欄または0）
                    </p>
                  </div>

                  {/* ACC Pit Rules */}
                  <div className="space-y-4 sm:col-span-2 p-4 border border-slate-800 bg-slate-950/50 rounded-xl">
                    <h3 className="text-sm font-semibold text-slate-300 mb-2 flex items-center">
                      <Timer className="w-4 h-4 mr-2" />
                      ACC ピット作業時間ルール (Pit Time Rules)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">ピットロスタイム (走行時間)</label>
                        <div className="relative">
                          <input type="number" value={pitLossTime} onChange={(e) => setPitLossTime(e.target.value ? Number(e.target.value) : '')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white" />
                          <span className="absolute right-3 top-2 text-slate-500 text-xs">秒</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">タイヤ交換時間</label>
                        <div className="relative">
                          <input type="number" value={tireChangeTime} onChange={(e) => setTireChangeTime(e.target.value ? Number(e.target.value) : '')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white" />
                          <span className="absolute right-3 top-2 text-slate-500 text-xs">秒</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">給油速度 (1Lあたり)</label>
                        <div className="relative">
                          <input type="number" step="0.1" value={refuelTimePerL} onChange={(e) => setRefuelTimePerL(e.target.value ? Number(e.target.value) : '')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white" />
                          <span className="absolute right-3 top-2 text-slate-500 text-xs">秒/L</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Alert & Safety Settings */}
                  <div className="space-y-4 sm:col-span-2 p-4 border border-slate-800 bg-slate-950/50 rounded-xl">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-300 flex items-center">
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        アラート・安全設定
                      </h3>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <span className="text-xs text-slate-400">アラート</span>
                        <input
                          type="checkbox"
                          checked={alertsEnabled}
                          onChange={(e) => setAlertsEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 text-red-500 focus:ring-red-500 bg-slate-900"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">安全マージン</label>
                        <div className="relative">
                          <input type="number" step="0.1" min="0" value={safetyMarginLaps} onChange={(e) => setSafetyMarginLaps(e.target.value ? Number(e.target.value) : '')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white" />
                          <span className="absolute right-3 top-2 text-slate-500 text-xs">Lap</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">最低残燃料</label>
                        <div className="relative">
                          <input type="number" step="0.5" min="0" value={minReserveFuel} onChange={(e) => setMinReserveFuel(e.target.value ? Number(e.target.value) : '')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white" />
                          <span className="absolute right-3 top-2 text-slate-500 text-xs">L</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">タイヤ空気圧 (下限)</label>
                        <div className="relative">
                          <input type="number" step="0.1" value={tyrePressureMin} onChange={(e) => setTyrePressureMin(e.target.value ? Number(e.target.value) : '')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white" />
                          <span className="absolute right-3 top-2 text-slate-500 text-xs">psi</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-slate-400">タイヤ空気圧 (上限)</label>
                        <div className="relative">
                          <input type="number" step="0.1" value={tyrePressureMax} onChange={(e) => setTyrePressureMax(e.target.value ? Number(e.target.value) : '')} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm text-white" />
                          <span className="absolute right-3 top-2 text-slate-500 text-xs">psi</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      安全マージン・最低残燃料はFuel Engineの警告判定に使われます。タイヤ空気圧はドライGT3の一般的な目安値です(車種により調整してください)。
                    </p>
                  </div>

                  {/* Strategy Type */}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="flex items-center text-sm font-medium text-slate-300">
                      <Settings2 className="w-4 h-4 mr-2 text-slate-400" />
                      燃料配分 (Fuel Distribution)
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setStrategyType('equal')}
                        className={`py-3 px-4 rounded-xl border flex items-center justify-center transition-all ${
                          strategyType === 'equal'
                            ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-medium'
                            : 'bg-slate-950 border-slate-700 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        <ArrowRightLeft className="w-4 h-4 mr-2" />
                        均等配分 (Equal)
                      </button>
                      <button
                        onClick={() => setStrategyType('full')}
                        className={`py-3 px-4 rounded-xl border flex items-center justify-center transition-all ${
                          strategyType === 'full'
                            ? 'bg-blue-600/20 border-blue-500 text-blue-400 font-medium'
                            : 'bg-slate-950 border-slate-700 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        <Fuel className="w-4 h-4 mr-2" />
                        満タン優先 (Full First)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {renderEmergencyInput()}
            </div>
          )}

          {/* Results Panel */}
          <div className={`${isSimpleMode ? 'lg:col-span-12 gap-3' : 'lg:col-span-5 gap-6'} flex flex-col transition-all duration-300`}>
            {/* Emergency Recalculate - Shown in Both Modes */}
            {isSimpleMode && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md">
                <button
                  onClick={() => setShowEmergency(!showEmergency)}
                  className="w-full flex items-center justify-between px-3.5 py-3 bg-yellow-950/20 hover:bg-yellow-950/30 text-yellow-400 text-xs sm:text-sm font-semibold transition-colors focus:outline-none"
                >
                  <span className="flex items-center text-xs sm:text-sm font-bold">
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    緊急・イレギュラーピット入力 (Emergency Recalculate)
                  </span>
                  <span className="text-xs font-bold bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">
                    {showEmergency ? '閉じる ▲' : '設定を開く ▼'}
                  </span>
                </button>
                {showEmergency && (
                  <div className="p-3 border-t border-slate-800 bg-slate-950/20">
                    {renderEmergencyInput()}
                  </div>
                )}
              </div>
            )}

            {results ? (
              <>
                {isSimpleMode ? (
                  /* Compact layout optimized for smartphone / race mode */
                  <div className="space-y-3">
                    {/* 1. Super Compact Overall Row */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 shadow-md flex items-center justify-around text-center">
                      <div className="flex-1">
                        <span className="text-slate-400 text-[11px] sm:text-xs block mb-0.5">合計必要燃料</span>
                        <div className="font-mono leading-none">
                          <span className="font-extrabold text-white text-lg sm:text-xl">
                            {results.isEmergency ? results.totalFuelNeededForCoverage : results.totalFuel}
                          </span>
                          <span className="text-xs text-slate-500 ml-0.5">L</span>
                        </div>
                      </div>
                      <div className="h-6 w-[1px] bg-slate-800"></div>
                      <div className="flex-1">
                        <span className="text-slate-400 text-[11px] sm:text-xs block mb-0.5">予想周回数</span>
                        <div className="font-mono leading-none">
                          <span className="font-extrabold text-white text-lg sm:text-xl">
                            {results.isEmergency ? results.lapsToCover : results.totalLaps}
                          </span>
                          <span className="text-xs text-slate-500 ml-0.5">Laps</span>
                        </div>
                      </div>
                      <div className="h-6 w-[1px] bg-slate-800"></div>
                      <div className="flex-1">
                        <span className="text-slate-400 text-[11px] sm:text-xs block mb-0.5">必要ピット</span>
                        <div className="font-mono leading-none">
                          <span className="font-extrabold text-blue-400 text-lg sm:text-xl">
                            {results.totalPits}
                          </span>
                          <span className="text-xs text-blue-500 ml-0.5">回</span>
                        </div>
                      </div>
                    </div>

                    {/* 2. Primary: Stint Strategy (Fuel) - Most important during race */}
                    <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-xl p-3.5 shadow-lg">
                      <h2 className="text-slate-200 font-bold mb-3 uppercase text-xs sm:text-sm flex items-center tracking-wider">
                        <Flag className="w-4 h-4 mr-1.5 text-red-500" />
                        スティント燃料配分 (Stint Strategy)
                      </h2>
                      
                      <div className="space-y-2">
                        {results.stints.map((stint, idx) => (
                          <div key={idx} className={`bg-slate-950/80 border rounded-xl p-3 flex flex-col gap-2 ${stint.isEmergencyStart ? 'border-yellow-700/50 relative overflow-hidden bg-yellow-950/5' : 'border-slate-800/80'}`}>
                            {stint.isEmergencyStart && <div className="absolute left-0 top-0 w-1 h-full bg-yellow-500"></div>}
                            <div className="flex items-center justify-between">
                              <div className="min-w-0 flex-1">
                                <div className={`text-[14px] sm:text-base font-extrabold truncate leading-tight ${stint.isEmergencyStart ? 'text-yellow-400' : 'text-slate-100'}`}>
                                  {stint.label}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <span className="text-slate-300 font-mono text-xs sm:text-sm font-bold bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-800">
                                    {stint.startLap === stint.endLap ? `Lap ${stint.startLap}` : `L${stint.startLap}〜L${stint.endLap}`} ({stint.laps}周)
                                  </span>
                                  {idx < results.stints.length - 1 && (
                                    <span className="font-mono text-indigo-300 inline-flex items-center text-[11px] sm:text-xs bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-900/40">
                                      <Clock className="w-3.5 h-3.5 mr-0.5" />
                                      {stint.pitTimeElapsed}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <div className="flex items-center space-x-3">
                                  <div>
                                    <div className="text-[11px] text-slate-400 leading-none mb-1 font-semibold">
                                      {stint.isEmergencyStart ? '今回給油' : (idx === 0 ? '初期搭載' : '給油量')}
                                    </div>
                                    <div className="font-black font-mono text-white text-lg sm:text-xl leading-none">
                                      {stint.addedFuel}<span className="text-xs text-slate-400 ml-0.5">L</span>
                                    </div>
                                  </div>
                                  
                                  {(idx > 0 || stint.isEmergencyStart) && (
                                    <div className="border-l border-slate-800 pl-3">
                                      <div className="text-[11px] text-slate-500 leading-none mb-1 font-semibold">ピットアウト時</div>
                                      <div className="font-black font-mono text-slate-200 text-base sm:text-lg leading-none">
                                        {stint.targetFuelInTank}<span className="text-xs text-slate-500 ml-0.5">L</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {(idx > 0 || stint.isEmergencyStart) && (
                              <div className="mt-1 flex items-center justify-end gap-3 text-[11px] border-t border-slate-800/60 pt-2">
                                <div className="text-slate-400">
                                  静止時間: <span className="font-mono text-slate-200">{stint.pitStationaryTime.toFixed(1)}s</span>
                                </div>
                                <div className="text-slate-400">
                                  合計損失: <span className="font-mono text-slate-200">{stint.pitTotalTime.toFixed(1)}s</span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 3. Recommended Pit Windows */}
                    {results.pitStopsTiming.length > 0 && (
                      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md">
                        <h2 className="text-slate-300 font-bold mb-2 uppercase text-xs sm:text-sm flex items-center tracking-wider">
                          <Clock className="w-3.5 h-3.5 mr-1 text-indigo-400" />
                          推奨ピット窓 (Pit Windows)
                        </h2>
                        
                        <div className="grid grid-cols-1 gap-1.5">
                          {results.pitStopsTiming.map((pit, idx) => (
                            <div key={idx} className="bg-slate-950 border border-slate-800/80 rounded-lg p-2 flex items-center justify-between gap-1">
                              <span className="text-white font-bold text-xs whitespace-nowrap min-w-[64px] border-r border-slate-800 pr-1.5">
                                Pit Stop {pit.stopNumber}
                              </span>
                              
                              <div className="flex-1 grid grid-cols-3 gap-1 text-center items-center">
                                {/* Undercut */}
                                <div className={`flex flex-col justify-center leading-tight ${pit.canUndercut ? '' : 'opacity-20'}`}>
                                  <span className="text-orange-400 text-[10px] font-bold uppercase">アンダー</span>
                                  <span className="font-mono text-xs text-slate-300 font-bold">
                                    {pit.undercutStart === pit.undercutEnd ? `L${pit.undercutStart}` : `L${pit.undercutStart}-${pit.undercutEnd}`}
                                  </span>
                                </div>
                                
                                {/* Standard */}
                                <div className="bg-blue-950/20 border-x border-slate-800/80 py-0.5 flex flex-col justify-center leading-tight">
                                  <span className="text-blue-400 text-[10px] font-bold uppercase">標準</span>
                                  <span className="font-mono text-sm font-black text-white">L{pit.targetLap}</span>
                                </div>
                                
                                {/* Overcut */}
                                <div className={`flex flex-col justify-center leading-tight ${pit.canOvercut ? '' : 'opacity-20'}`}>
                                  <span className="text-emerald-400 text-[10px] font-bold uppercase">オーバー</span>
                                  <span className="font-mono text-xs text-slate-300 font-bold">
                                    {pit.overcutStart === pit.overcutEnd ? `L${pit.overcutStart}` : `L${pit.overcutStart}-${pit.overcutEnd}`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 4. Recommended Setup (Brake Pad) */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md">
                      <h2 className="text-slate-300 font-bold mb-2 uppercase text-xs sm:text-sm flex items-center tracking-wider">
                        <Wrench className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        推奨セットアップ (Recommended Setup)
                      </h2>
                      <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-400">ブレーキパッド</span>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-2xl font-black text-white">
                            Pad {results.brakePadRecommendation}
                          </span>
                          {results.isRaining && <span className="text-xs text-blue-400 font-bold">(ウェット設定)</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard view for desktop/full mode */
                  <>
                    <div className="flex flex-col gap-6">
                      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl">
                        <h2 className="text-slate-400 font-medium mb-6 uppercase text-sm flex items-center">
                          <Calculator className="w-4 h-4 mr-2" />
                          {results.isEmergency ? '残りの全体計算結果 (Remaining)' : '全体計算結果 (Overall)'}
                        </h2>
                        
                        <div className="grid grid-cols-2 gap-4 mb-6">
                          <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800">
                            <p className="text-slate-400 text-xs mb-1">{results.isEmergency ? '残りの必要燃料' : '必要な合計燃料'}</p>
                            <div className="flex items-baseline font-mono">
                              <span className="font-bold text-white text-3xl">{results.isEmergency ? results.totalFuelNeededForCoverage : results.totalFuel}</span>
                              <span className="text-sm text-slate-500 ml-1">L</span>
                            </div>
                          </div>
                          <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800">
                            <p className="text-slate-400 text-xs mb-1">{results.isEmergency ? '残り周回数' : '予想周回数'}</p>
                            <div className="flex items-baseline font-mono">
                              <span className="font-bold text-white text-3xl">{results.isEmergency ? results.lapsToCover : results.totalLaps}</span>
                              <span className="text-sm text-slate-500 ml-1">Laps</span>
                            </div>
                            {!results.isEmergency && <p className="text-[10px] text-slate-500 mt-1">実質: {results.rawLaps.toFixed(2)} 周</p>}
                          </div>
                        </div>

                        <div className="rounded-xl p-4 border bg-blue-950/30 border-blue-900/50">
                          <p className="text-blue-400 text-xs mb-1">{results.isEmergency ? '追加ピットストップ回数' : '必要ピットストップ回数'}</p>
                          <div className="flex items-baseline font-mono">
                            <span className="font-bold text-blue-100 text-4xl">{results.totalPits}</span>
                            <span className="text-sm ml-2 text-blue-400">Stops</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex-grow flex flex-col justify-between">
                        <div>
                          <h2 className="text-slate-300 font-bold mb-6 uppercase text-base flex items-center">
                            <Flag className="w-5 h-5 mr-2.5 text-red-500" />
                            {results.isEmergency ? '緊急ピットからの戦略 (Strategy from Pit)' : 'スティント別の燃料 (Stint Strategy)'}
                          </h2>
                          
                          <div className="space-y-3.5">
                            {results.stints.map((stint, idx) => (
                              <div key={idx} className={`bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 ${stint.isEmergencyStart ? 'border-yellow-700/50 relative overflow-hidden bg-yellow-950/5' : ''}`}>
                                {stint.isEmergencyStart && <div className="absolute left-0 top-0 w-1.5 h-full bg-yellow-500"></div>}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                  <div>
                                    <div className={`text-base sm:text-lg font-black mb-1.5 ${stint.isEmergencyStart ? 'text-yellow-400' : 'text-slate-100'}`}>{stint.label}</div>
                                    <div className="flex flex-col sm:flex-row sm:items-center mt-1 gap-2.5 sm:gap-4">
                                      <span className="text-slate-300 font-mono text-sm font-bold bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">
                                        {stint.startLap === stint.endLap ? `Lap ${stint.startLap}` : `L${stint.startLap}〜L${stint.endLap}`} ({stint.laps}周)
                                      </span>
                                      {idx < results.stints.length - 1 && (
                                        <span className="font-mono font-bold text-indigo-300 inline-flex items-center text-sm bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-900/40">
                                          <Clock className="w-4 h-4 mr-1" />
                                          {stint.pitTimeElapsed}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="flex items-end justify-end space-x-6">
                                      <div>
                                        <div className="text-xs sm:text-sm font-semibold text-slate-400 mb-1">{stint.isEmergencyStart ? '今回の給油' : (idx === 0 ? '初期搭載' : '給油量')}</div>
                                        <div className="font-black font-mono text-white text-2xl sm:text-3xl">
                                          {stint.addedFuel}<span className="text-sm sm:text-base text-slate-400 ml-1">L</span>
                                        </div>
                                      </div>
                                      
                                      {(idx > 0 || stint.isEmergencyStart) && (
                                        <div className="border-l border-slate-800 pl-6">
                                          <div className="text-xs sm:text-sm font-semibold text-slate-500 mb-1">ピットアウト時</div>
                                          <div className="font-black font-mono text-slate-300 text-xl sm:text-2xl">
                                            {stint.targetFuelInTank}<span className="text-sm sm:text-base text-slate-500 ml-1">L</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {(idx > 0 || stint.isEmergencyStart) && (
                                  <div className="flex items-center justify-end gap-6 text-sm border-t border-slate-800/80 pt-3">
                                    <div className="text-slate-400">
                                      ピット静止時間: <span className="font-mono font-bold text-white ml-1">{stint.pitStationaryTime.toFixed(1)} s</span>
                                    </div>
                                    <div className="text-slate-400">
                                      合計ピット損失: <span className="font-mono font-bold text-white ml-1">{stint.pitTotalTime.toFixed(1)} s</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 mt-6 leading-relaxed">
                          ※ 燃料配分は概算です。セーフティカーや天候変化により実際の消費量は変動する場合があります。
                        </p>
                      </div>
                    </div>

                    {results.pitStopsTiming.length > 0 && (
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mt-6">
                        <h2 className="text-slate-400 font-medium mb-6 uppercase text-sm flex items-center">
                          <Clock className="w-4 h-4 mr-2" />
                          推奨ピットウィンドウ (Pit Windows)
                        </h2>
                        
                        <div className="grid grid-cols-1 gap-4">
                          {results.pitStopsTiming.map((pit, idx) => (
                            <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                              <h3 className="text-white font-medium mb-4 text-sm border-b border-slate-800 pb-2">
                                ピットストップ {pit.stopNumber}
                              </h3>
                              
                              <div className="grid grid-cols-3 gap-4 text-center">
                                {/* Undercut */}
                                <div className={`flex flex-col justify-center ${pit.canUndercut ? '' : 'opacity-30'}`}>
                                  <p className="text-orange-400 text-xs mb-1 font-medium uppercase tracking-wider">アンダーカット</p>
                                  <div className="font-mono text-sm sm:text-lg text-slate-300">
                                    {pit.undercutStart === pit.undercutEnd ? `L${pit.undercutStart}` : `L${pit.undercutStart} - L${pit.undercutEnd}`}
                                  </div>
                                </div>
                                
                                {/* Standard */}
                                <div className="border-x border-slate-800 px-2 sm:px-0 flex flex-col justify-center relative py-2 -my-2">
                                  <div className="absolute inset-0 bg-blue-500/5 rounded-lg -z-10"></div>
                                  <p className="text-blue-400 text-xs mb-1 font-medium uppercase tracking-wider">標準 (Standard)</p>
                                  <div className="font-mono text-base sm:text-xl font-bold text-white">Lap {pit.targetLap}</div>
                                </div>
                                
                                {/* Overcut */}
                                <div className={`flex flex-col justify-center ${pit.canOvercut ? '' : 'opacity-30'}`}>
                                  <p className="text-emerald-400 text-xs mb-1 font-medium uppercase tracking-wider">オーバーカット</p>
                                  <div className="font-mono text-sm sm:text-lg text-slate-300">
                                    {pit.overcutStart === pit.overcutEnd ? `L${pit.overcutStart}` : `L${pit.overcutStart} - L${pit.overcutEnd}`}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mt-6">
                      <h2 className="text-slate-400 font-medium mb-4 uppercase text-sm flex items-center">
                        <Wrench className="w-4 h-4 mr-2" />
                        推奨セットアップ (Recommended Setup)
                      </h2>
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
                        <span className="text-slate-300 font-medium">ブレーキパッド</span>
                        <div className="flex items-center gap-4">
                          <span className="font-mono text-3xl font-black text-white">
                            Pad {results.brakePadRecommendation}
                          </span>
                          {results.isRaining && <span className="text-sm text-blue-400 font-bold bg-blue-900/20 px-3 py-1 rounded-full border border-blue-800">(ウェット設定)</span>}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex items-center justify-center h-full min-h-[300px]">
                <div className="text-center text-slate-500">
                  <Calculator className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>計算に必要な数値を入力してください</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ACC Bridge Connection Modal */}
      {isAccBridgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-bold text-white flex items-center">
                <Gauge className="w-5 h-5 mr-2 text-red-400" />
                ACC Bridge 連携 (WebSocket)
              </h2>
              <button onClick={() => setIsAccBridgeModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-300">
                C++ ブリッジから周回数・燃料・燃費を受信して、戦略計算の入力に反映します。
              </p>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase">準備</h3>
                <ol className="text-sm text-slate-300 list-decimal list-inside space-y-2">
                  <li>Assetto Corsa Competizione を起動します。</li>
                  <li><code>acc app.cpp</code> をビルドしたブリッジを実行します。</li>
                  <li>下の URL がブリッジの待受ポートと一致していることを確認します。</li>
                </ol>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">WebSocket URL</label>
                <input
                  type="text"
                  value={accBridgeUrl}
                  onChange={(e) => setAccBridgeUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-red-500"
                  placeholder={DEFAULT_ACC_BRIDGE_URL}
                />
              </div>

              {accBridgeTelemetry && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase">Lap</p>
                    <p className="font-mono text-lg font-bold text-white">{accBridgeTelemetry.lap ?? '-'}</p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase">Fuel</p>
                    <p className="font-mono text-lg font-bold text-white">
                      {typeof accBridgeTelemetry.fuel === 'number' ? `${roundTo(accBridgeTelemetry.fuel, 1)}L` : '-'}
                    </p>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <p className="text-[10px] text-slate-500 uppercase">F/Lap</p>
                    <p className="font-mono text-lg font-bold text-white">
                      {typeof accBridgeTelemetry.fuelPerLap === 'number' ? `${roundTo(accBridgeTelemetry.fuelPerLap, 2)}L` : '-'}
                    </p>
                  </div>
                </div>
              )}

              {accBridgeTelemetry?.connected === false && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm p-3 rounded-lg">
                  ブリッジには接続済みですが、ACC の共有メモリはまだ読めていません。
                </div>
              )}

              {accBridgeErrorMsg && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg">
                  {accBridgeErrorMsg}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-slate-800 flex justify-end gap-3 bg-slate-950/50">
              {accBridgeStatus === 'connected' ? (
                <button
                  onClick={() => {
                    disconnectAccBridge();
                    setIsAccBridgeModalOpen(false);
                  }}
                  className="bg-red-600 hover:bg-red-500 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  切断する
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setIsAccBridgeModalOpen(false)}
                    className="text-slate-300 hover:text-white px-4 py-2 text-sm"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={connectAccBridge}
                    disabled={accBridgeStatus === 'connecting'}
                    className="bg-red-600 hover:bg-red-500 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center"
                  >
                    {accBridgeStatus === 'connecting' ? '接続中...' : '接続する'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SimHub Connection Modal */}
      {isSimHubModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-bold text-white flex items-center">
                <Settings2 className="w-5 h-5 mr-2 text-emerald-400" />
                SimHub 連携 (ローカル)
              </h2>
              <button onClick={() => setIsSimHubModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-300">
                SimHubのREST APIを使用して、現在の周回数や燃料を自動取得します。ブラウザのセキュリティ制限により、この機能は<strong>ローカル環境（ダウンロード版）</strong>またはOBSのブラウザソースでのみ動作する場合があります。
              </p>
              
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase">準備</h3>
                <ol className="text-sm text-slate-300 list-decimal list-inside space-y-2">
                  <li>SimHubの左メニューから <strong>Settings</strong> を開きます。</li>
                  <li><strong>Webサーバーポート (Web server port)</strong> が <code>8888</code> になっていることを確認します。</li>
                  <li>この画面の下部にある「接続テスト」をクリックして、通信できれば準備完了です。</li>
                </ol>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm p-3 rounded-xl space-y-2">
                <p className="font-bold flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1" />
                  現在の画面からは接続できません
                </p>
                <p className="text-xs">
                  このページは安全な通信(HTTPS)で提供されているため、ブラウザのセキュリティ制限(Mixed Content)によりPC(localhost)への通信がブロックされます。
                </p>
                <p className="text-xs">
                  使用するには、右上のメニューからアプリをダウンロード（ZIP）してPC上で動かすか、ビルドしてSimHubの <code>DashTemplates</code> フォルダに入れてアクセスしてください。
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400">API URL</label>
                <input
                  type="text"
                  value={simHubUrl}
                  onChange={(e) => setSimHubUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="http://localhost:8888"
                />
              </div>

              {simHubErrorMsg && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-lg">
                  {simHubErrorMsg}
                </div>
              )}
            </div>
            
            <div className="p-5 border-t border-slate-800 flex justify-end gap-3 bg-slate-950/50">
              {simHubStatus === 'connected' ? (
                <button
                  onClick={() => {
                    setSimHubStatus('disconnected');
                    setIsSimHubModalOpen(false);
                  }}
                  className="bg-red-600 hover:bg-red-500 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  切断する
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setIsSimHubModalOpen(false)}
                    className="text-slate-300 hover:text-white px-4 py-2 text-sm"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => connectSimHub(false)}
                    disabled={simHubStatus === 'connecting'}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center"
                  >
                    {simHubStatus === 'connecting' ? '接続中...' : '接続テスト'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


