import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Layout from './components/Layout';
import DEMO_QUERY_DATA from './data/demoAnalysis.json';

const RESULT_TABS = [
  { key: 'overview', label: '總覽' },
  { key: 'drug', label: '抗藥圖譜' },
  { key: 'antibiotic', label: '抗生素圖譜' },
  { key: 'similar', label: '相似樣本' },
  { key: 'map', label: '地圖分布' },
];

const RAW_ANTIBIOTIC_LIST = [
  'Itraconazole',
  'Posaconazole',
  'Voriconazole',
  'Fluconazole',
  'Ketoconazole',
  'Amphotericin B',
  'Ravuconazole',
  'Bromuconazole',
  'Cyproconazole',
  'Difenoconazole',
  'Epoxiconazole',
  'Hexaconazole',
  'Isavuconazole',
  'Metconazole',
  'Penconazole',
  'Tebuconazole',
  'Triadimefon',
  'Tricyclazole',
  'Caspofungin',
  '5-fluorocytosine',
  'Miconazole',
  'Anidulafungin',
  'Micafungin',
  'Bifonazole',
  'Imazalil',
  'Prochloraz',
  'Propiconazole',
  'Azole(s)',
  'Azoxystrobin',
  'Benomyl',
  'Boscalid',
  'Carbendazim',
  'Fluopyram',
  'Pyraclostrobin',
  'Terbinafine',
];

// 抗生素依照 A 到 Z 字母排序
const ANTIBIOTIC_LIST = [...RAW_ANTIBIOTIC_LIST].sort((a, b) =>
  a.localeCompare(b, 'en', { sensitivity: 'base' })
);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isValidCSV = (text) => {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<?xml') ||
    trimmed.includes('<script') ||
    trimmed.includes('/@vite/client')
  ) {
    return false;
  }
  return true;
};

const parseCSV = (text) => {
  if (!isValidCSV(text)) return { headers: [], rows: [] };
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  // 自動判斷分隔符號：如果包含 Tab 就用 '\t'，否則用 ','
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    return obj;
  });

  return { headers, rows };
};

const normalizeMutation = (value) => (value || '').trim();
const formatMutationDisplay = (value) => (
  typeof value === 'string'
    ? value.replace(/\b([ACDEFGHIKLMNPQRSTVWY]\d+)-(?![A-Za-z0-9])/gi, '$1del')
    : value
);

// 判斷是否為 TR34
const isTR34 = (mutation) => {
  const norm = normalizeMutation(mutation).toLowerCase();
  return /^tr34/i.test(norm) || norm.includes('tr34');
};

// 取出突變中的點位數字進行精確排序
const getMutationOrderValue = (mutation) => {
  const match = normalizeMutation(mutation).match(/-?\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
};

// 基因名稱標準化
const normalizeGeneName = (gene) => {
  const g = (gene || '').trim();
  if (!g) return 'Unknown';
  if (/^cyp51a$/i.test(g)) return 'Cyp51A';
  if (/^cyp51b$/i.test(g)) return 'Cyp51B';
  if (/^fks1$/i.test(g)) return 'FKS1';
  if (/^hmg1$/i.test(g)) return 'HMG1';
  return g;
};

// 解析複合表頭字串
const parseMutationHeader = (rawKey) => {
  if (!rawKey) return { gene: 'Unknown', mutation: rawKey, reference: '' };
  const trimmed = rawKey.trim();

  const dashParts = trimmed.split('-');
  if (dashParts.length >= 2) {
    let gene = '';
    let mutation = '';
    let reference = '';

    dashParts.forEach((part) => {
      const p = part.trim();
      if (
        /^[OPQ][0-9][A-Z0-9]{3}[0-9]$/i.test(p) ||
        (/^[A-Z0-9]{6,12}$/i.test(p) && /\d/.test(p) && !/^[A-Z]\d+[A-Z]$/i.test(p) && !/^TR/i.test(p))
      ) {
        reference = p;
      } else if (/^(cyp|fks|hmg|erg|cdr|mdr|fur|tub|cox)/i.test(p)) {
        gene = p;
      } else {
        mutation = p;
      }
    });

    if (!gene && dashParts.length === 3) {
      if (/\d/.test(dashParts[0]) && /[a-z]/i.test(dashParts[0])) {
        mutation = dashParts[0];
        gene = dashParts[1];
        reference = dashParts[2];
      } else {
        gene = dashParts[0];
        mutation = dashParts[1];
        reference = dashParts[2];
      }
    } else if (!gene && dashParts.length === 2) {
      gene = dashParts[0];
      mutation = dashParts[1];
    }

    if (!mutation) mutation = dashParts[0] === gene ? dashParts[1] : dashParts[0];

    return {
      gene: normalizeGeneName(gene),
      mutation: normalizeMutation(mutation),
      reference: reference.trim(),
    };
  }

  if (trimmed.includes('::')) {
    const parts = trimmed.split('::');
    if (parts.length === 3) {
      return { gene: normalizeGeneName(parts[0]), reference: parts[1].trim(), mutation: normalizeMutation(parts[2]) };
    }
    return { gene: normalizeGeneName(parts[0]), reference: '', mutation: normalizeMutation(parts[1]) };
  }

  if (trimmed.includes('_')) {
    const parts = trimmed.split('_');
    return {
      gene: normalizeGeneName(parts[0]),
      reference: '',
      mutation: normalizeMutation(parts.slice(1).join('_')),
    };
  }

  return { gene: 'Unknown', mutation: trimmed, reference: '' };
};

// 建立 Cyp51A 突變欄位（過濾 TR34、僅保留 Cyp51A、依點位編號數字排序）
const buildMutationColumns = (reportRecords = [], dbMutationKeys = [], targetReference = '') => {
  const columns = [];
  const seenCanonicalKeys = new Set(); // 統一去重 Key 集合

  // A. 處理資料庫矩陣欄位
  dbMutationKeys.forEach((rawKey) => {
    if (!rawKey) return;
    const { gene, mutation, reference } = parseMutationHeader(rawKey);

    // 嚴格篩選：只保留 Cyp51A
    if (gene !== 'Cyp51A') return;
    // 嚴格過濾 TR34（包含 TR34(x3)）
    if (isTR34(mutation)) return;

    // 參考序列過濾
    if (targetReference && reference && reference !== targetReference) {
      return;
    }

    // 統一規範化鍵名：例如 "Cyp51A::Q9P8R0::L98H"
    const canonicalKey = `${gene}::${reference || 'Unknown'}::${mutation.toUpperCase()}`;
    if (seenCanonicalKeys.has(canonicalKey)) return;
    seenCanonicalKeys.add(canonicalKey);

    columns.push({
      id: rawKey,
      rawKey,
      canonicalKey,
      gene,
      geneLabel: reference ? `${gene} (${reference})` : gene,
      reference,
      mutation,
      orderValue: getMutationOrderValue(mutation),
    });
  });

  // B. 處理使用者本次報告欄位
  reportRecords.forEach((record) => {
    const gene = normalizeGeneName(record.gene || 'Unknown');
    if (gene !== 'Cyp51A') return;

    const reference = record.reference ? record.reference.trim() : '';
    if (targetReference && reference && reference !== targetReference) {
      return;
    }

    (record.mutationSites || []).forEach((mutation) => {
      const normalizedMut = normalizeMutation(mutation);
      if (!normalizedMut || isTR34(normalizedMut)) return;

      // 檢查是否已在資料庫或先前點位中收錄
      const canonicalKey = `${gene}::${reference || 'Unknown'}::${normalizedMut.toUpperCase()}`;
      if (seenCanonicalKeys.has(canonicalKey)) return;
      seenCanonicalKeys.add(canonicalKey);

      columns.push({
        id: canonicalKey,
        rawKey: canonicalKey,
        canonicalKey,
        gene,
        geneLabel: reference ? `${gene} (${reference})` : gene,
        reference,
        mutation: normalizedMut,
        orderValue: getMutationOrderValue(normalizedMut),
      });
    });
  });

  // 嚴格依「點位數字」升冪排序，若數字相同則按字母排序
  return columns.sort((a, b) => {
    if (a.orderValue !== b.orderValue) {
      return a.orderValue - b.orderValue;
    }
    return (a.mutation || '').localeCompare(b.mutation || '', 'en', { sensitivity: 'base' });
  });
};

// ==================== 全球坐標庫 ====================
const COUNTRY_COORDINATES = {
  Australia: [-25, 133],
  Austria: [47.51, 14.55],
  Brazil: [-10, -55],
  Canada: [56, -106],
  China: [35, 103],
  Egypt: [27, 30],
  France: [46, 2],
  Germany: [51, 10],
  India: [22, 79],
  Iran: [32, 53],
  Ireland: [53.14, -7.69],
  Italy: [42, 12],
  Japan: [36, 138],
  Netherlands: [52, 5],
  'New Zealand': [-40.9, 174.88],
  Peru: [-9.19, -75.01],
  Russia: [61.52, 105.31],
  Singapore: [1.35, 103.82],
  'South Korea': [36, 128],
  Spain: [40, -4],
  Taiwan: [23.7, 120.9],
  Turkey: [39, 35],
  'United Kingdom': [54, -2],
  'United States': [39, -98],
};

const COUNTRY_NAME_RULES = [
  { key: 'United States', match: /\b(usa|united states|u\.s\.a\.|u\.s\.|america)\b/i },
  { key: 'United Kingdom', match: /\b(united kingdom|uk|u\.k\.|england|scotland|wales|manchester|london)\b/i },
  { key: 'Canada', match: /\bcanada\b/i },
  { key: 'China', match: /\bchina\b/i },
  { key: 'Germany', match: /\bgermany\b/i },
  { key: 'France', match: /\bfrance\b/i },
  { key: 'Australia', match: /\baustralia\b/i },
  { key: 'Austria', match: /\baustria\b/i },
  { key: 'Brazil', match: /\bbrazil\b/i },
  { key: 'Egypt', match: /\begypt\b/i },
  { key: 'Ireland', match: /\bireland\b/i },
  { key: 'Netherlands', match: /\bnetherlands\b/i },
  { key: 'New Zealand', match: /\bnew zealand\b/i },
  { key: 'Peru', match: /\bperu\b/i },
  { key: 'Russia', match: /\brussia\b/i },
  { key: 'Singapore', match: /\bsingapore\b/i },
  { key: 'Spain', match: /\bspain\b/i },
  { key: 'Taiwan', match: /\btaiwan\b/i },
  { key: 'Japan', match: /\bjapan\b/i },
  { key: 'India', match: /\bindia\b/i },
  { key: 'Iran', match: /\biran\b/i },
  { key: 'Italy', match: /\bitaly\b/i },
  { key: 'South Korea', match: /\b(south korea|korea)\b/i },
  { key: 'Turkey', match: /\bturkey\b/i },
];

const parseCountryFromLocation = (locStr) => {
  if (!locStr || typeof locStr !== 'string') return null;
  const s = locStr.trim();
  for (let i = 0; i < COUNTRY_NAME_RULES.length; i += 1) {
    if (COUNTRY_NAME_RULES[i].match.test(s)) {
      return COUNTRY_NAME_RULES[i].key;
    }
  }
  return null;
};

const parseYearFromDate = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return '未知';
  const match = dateStr.match(/\b(19\d\d|20\d\d)\b/);
  return match ? match[1] : '未知';
};

const buildCountryStatistics = (records = []) => {
  const countries = new Map();

  records.forEach((record) => {
    const coordinates = COUNTRY_COORDINATES[record.country];
    if (!coordinates) return;

    if (!countries.has(record.country)) {
      countries.set(record.country, {
        country: record.country,
        position: coordinates,
        strains: new Set(),
        yearStrains: new Map(),
        drugStrains: new Map(),
        drugYearStrains: new Map(),
      });
    }

    const country = countries.get(record.country);
    const strainIds = record.strainIds?.length ? record.strainIds : [record.accessionNumber || record.strainId || 'Unknown'];
    const year = record.year ? String(record.year) : '未知';
    const drug = record.drug || '敏感 / 未檢出抗藥性';

    strainIds.forEach((strainId) => {
      if (!strainId) return;
      country.strains.add(strainId);

      if (!country.yearStrains.has(year)) country.yearStrains.set(year, new Set());
      country.yearStrains.get(year).add(strainId);

      if (!country.drugStrains.has(drug)) country.drugStrains.set(drug, new Set());
      country.drugStrains.get(drug).add(strainId);

      if (!country.drugYearStrains.has(drug)) country.drugYearStrains.set(drug, new Map());
      if (!country.drugYearStrains.get(drug).has(year)) {
        country.drugYearStrains.get(drug).set(year, new Set());
      }
      country.drugYearStrains.get(drug).get(year).add(strainId);
    });
  });

  return [...countries.values()].map((country) => {
    const years = [...country.yearStrains.keys()].sort((a, b) => {
      if (a === '未知') return 1;
      if (b === '未知') return -1;
      return Number(a) - Number(b);
    });
    const drugs = [...country.drugStrains.keys()].sort((a, b) => a.localeCompare(b));

    return {
      country: country.country,
      position: country.position,
      count: country.strains.size,
      yearData: years.map((year) => ({ year, strains: country.yearStrains.get(year).size })),
      drugData: drugs.map((drug) => ({ name: drug, strains: country.drugStrains.get(drug).size })),
      drugOptions: drugs,
      drugYearData: Object.fromEntries([...country.drugYearStrains.entries()].map(([drug, yearMap]) => [
        drug,
        years.map((year) => ({ year, strains: yearMap.get(year)?.size || 0 })),
      ])),
    };
  }).sort((a, b) => b.count - a.count);
};

const MapReference = ({ mapRef }) => {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => { mapRef.current = null; };
  }, [map, mapRef]);
  return null;
};

const MapSampleMarkers = ({ markers, accent, selectedCountry, onSelect }) => {
  const map = useMap();
  const [projectedMarkers, setProjectedMarkers] = useState([]);

  useEffect(() => {
    let frame = 0;
    const updateMarkers = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setProjectedMarkers(markers.map((marker) => ({
          ...marker,
          point: map.latLngToContainerPoint(marker.position),
        })));
      });
    };
    map.on('move zoom resize', updateMarkers);
    updateMarkers();
    return () => {
      map.off('move zoom resize', updateMarkers);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [map, markers]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[500]">
      {projectedMarkers.map((marker) => (
        <button
          key={marker.country}
          type="button"
          aria-label={`${marker.country} ${marker.count} 株`}
          aria-pressed={selectedCountry === marker.country}
          title={`${marker.country}：${marker.count} 株，點擊查看圖表`}
          onClick={() => onSelect(marker.country)}
          className={`pointer-events-auto absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-black text-white shadow-md hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white ${selectedCountry === marker.country ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-800' : ''}`}
          style={{ left: marker.point.x, top: marker.point.y, backgroundColor: accent }}
        >
          {marker.count}
        </button>
      ))}
    </div>
  );
};

const WorldMapDemo = ({ title, accent, chartMode, markers, onInteractionChange }) => {
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedDrug, setSelectedDrug] = useState('');
  const mapRef = useRef(null);

  useEffect(() => {
    if (markers.length > 0 && !selectedCountry) {
      setSelectedCountry(markers[0].country);
    }
  }, [markers, selectedCountry]);

  const selectedMarker = markers.find((marker) => marker.country === selectedCountry);
  const drugTotal = selectedMarker?.drugData.reduce((total, item) => total + item.strains, 0) || 0;
  const activeDrug = selectedMarker?.drugOptions.includes(selectedDrug)
    ? selectedDrug
    : selectedMarker?.drugOptions[0] || '';

  const renderLineChart = (data, label) => (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="year" />
        <YAxis allowDecimals={false} />
        <ChartTooltip />
        <Legend />
        <Line type="monotone" dataKey="strains" name={label} stroke={accent} strokeWidth={2.5} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <div className="relative overflow-hidden border-b border-gray-200 bg-white py-5" onMouseEnter={() => onInteractionChange(true)} onMouseLeave={() => onInteractionChange(false)}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-base font-black text-gray-800">{title}</h4>
        <span className="text-xs font-semibold text-gray-500">{markers.length} 個可定位國家</span>
      </div>
      <div className="mb-2 flex items-center justify-end gap-2">
        <button type="button" aria-label={`縮小${title}`} title="縮小地圖" onClick={() => mapRef.current?.zoomOut()} className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-lg font-bold text-gray-700 hover:bg-gray-100">-</button>
        <button type="button" aria-label={`放大${title}`} title="放大地圖" onClick={() => mapRef.current?.zoomIn()} className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-lg font-bold text-gray-700 hover:bg-gray-100">+</button>
        <button type="button" onClick={() => mapRef.current?.setView([20, 0], 2)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-100">重置</button>
      </div>
      <div className="relative h-[380px] overflow-hidden rounded-lg border border-gray-200">
        <MapContainer center={[20, 0]} zoom={2} minZoom={1} maxZoom={10} scrollWheelZoom zoomControl={false} worldCopyJump className="h-full w-full">
          <MapReference mapRef={mapRef} />
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapSampleMarkers markers={markers} accent={accent} selectedCountry={selectedCountry} onSelect={setSelectedCountry} />
        </MapContainer>
      </div>
      {markers.length === 0 && <p className="mt-3 text-sm text-gray-500">目前沒有可定位的國家資料。</p>}
      {selectedMarker && (
        <section className="mt-4 border-t border-gray-200 pt-4" aria-label={`${selectedCountry} 統計圖`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h5 className="font-bold text-gray-800">{selectedCountry}・{selectedMarker.count} 株菌株</h5>
            {chartMode === 'drug-year' && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <span>選擇抗生素</span>
                <select value={activeDrug} onChange={(event) => setSelectedDrug(event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 font-semibold text-xs">
                  {selectedMarker.drugOptions.map((drug) => <option key={drug} value={drug}>{drug}</option>)}
                </select>
              </label>
            )}
          </div>
          {chartMode === 'year' && renderLineChart(selectedMarker.yearData, '菌株採樣數量')}
          {chartMode === 'drug-share' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,1fr)] md:items-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={selectedMarker.drugData} dataKey="strains" nameKey="name" innerRadius={58} outerRadius={100} paddingAngle={2}>
                    {selectedMarker.drugData.map((entry, index) => <Cell key={entry.name} fill={['#0f766e', '#dc2626', '#2563eb', '#ca8a04', '#db2777', '#7c3aed', '#0891b2', '#059669', '#d97706'][index % 9]} />)}
                  </Pie>
                  <ChartTooltip formatter={(value, name) => [
                    `${value} 株 (${drugTotal ? ((Number(value) / drugTotal) * 100).toFixed(1) : '0.0'}%)`,
                    name,
                  ]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <div className="max-h-64 overflow-auto text-sm text-gray-700 pr-2">
                {selectedMarker.drugData.map((entry) => (
                  <div key={entry.name} className="flex justify-between gap-4 border-b border-gray-100 py-1.5 text-xs">
                    <span>{entry.name}</span>
                    <strong>{entry.strains} 株</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          {chartMode === 'drug-year' && renderLineChart(selectedMarker.drugYearData[activeDrug] || [], `${activeDrug} 抗藥菌株`)}
        </section>
      )}
    </div>
  );
};

// ==================== 統一全畫布 Heatmap（支援「最適寬度」） ====================
const CanvasHeatmap = ({
  columns = [],
  rows = [],
  geneGroups = null,
  getCellColor,
  getCellInfo,
  onInteractionChange,
}) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const [viewState, setViewState] = useState({ zoom: 1, panX: 20, panY: 20 });
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

  const [hoveredCell, setHoveredCell] = useState(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const hasTwoTierHeader = Boolean(geneGroups && geneGroups.length > 0);
  const CELL_W = 24;
  const CELL_H = 22;
  const ROW_HEADER_W = 220;
  const COL_HEADER_H = hasTwoTierHeader ? 160 : 120;
  const GENE_TIER_H = hasTwoTierHeader ? 42 : 0;

  const totalContentW = ROW_HEADER_W + columns.length * CELL_W;

  const calculateFitWidthScale = useCallback(() => {
    if (!containerRef.current || columns.length === 0) return 0.5;
    const rect = containerRef.current.getBoundingClientRect();
    const padding = 24;
    const availW = Math.max(rect.width - padding * 2, 100);
    const scale = availW / totalContentW;
    return clamp(scale, 0.005, 2.5);
  }, [columns.length, totalContentW]);

  const handleFitWidth = useCallback(() => {
    if (!containerRef.current || columns.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const padding = 20;
    const availW = Math.max(rect.width - padding * 2, 100);
    const fitScale = clamp(availW / totalContentW, 0.005, 2.5);

    setViewState({
      zoom: fitScale,
      panX: padding,
      panY: 16,
    });
  }, [totalContentW, columns.length]);

  useEffect(() => {
    if (columns.length > 0 && rows.length > 0) {
      handleFitWidth();
    }
  }, [columns.length, rows.length, handleFitWidth]);

  const zoomAtCenter = useCallback((zoomFactor) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    setViewState((prev) => {
      const minZ = Math.min(calculateFitWidthScale() * 0.5, 0.005);
      const newZoom = clamp(prev.zoom * zoomFactor, minZ, 2.5);
      if (newZoom === prev.zoom) return prev;

      const scaleRatio = newZoom / prev.zoom;
      return {
        zoom: newZoom,
        panX: centerX - (centerX - prev.panX) * scaleRatio,
        panY: centerY - (centerY - prev.panY) * scaleRatio,
      };
    });
  }, [calculateFitWidthScale]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (w <= 0 || h <= 0) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(viewState.panX, viewState.panY);
    ctx.scale(viewState.zoom, viewState.zoom);

    // 1. 矩陣格子
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const y = COL_HEADER_H + r * CELL_H;
      for (let c = 0; c < columns.length; c += 1) {
        const col = columns[c];
        const x = ROW_HEADER_W + c * CELL_W;
        ctx.fillStyle = getCellColor(row, col);
        ctx.fillRect(x, y, CELL_W - 0.5, CELL_H - 0.5);
      }
    }

    // 2. 左側樣本名稱
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      const y = COL_HEADER_H + r * CELL_H;

      ctx.fillStyle = row.isQuery ? '#eff6ff' : (r % 2 === 0 ? '#ffffff' : '#f9fafb');
      ctx.fillRect(0, y, ROW_HEADER_W, CELL_H);
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(0, y, ROW_HEADER_W, CELL_H);

      ctx.font = `${row.isQuery ? 'bold ' : ''}11px sans-serif`;
      ctx.fillStyle = row.isQuery ? '#4338ca' : '#374151';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const tag = row.isQuery ? '[查詢] ' : '';
      ctx.fillText(`${tag}${row.label}`, 8, y + CELL_H / 2, ROW_HEADER_W - 16);
    }
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ROW_HEADER_W, COL_HEADER_H);
    ctx.lineTo(ROW_HEADER_W, COL_HEADER_H + rows.length * CELL_H);
    ctx.stroke();

    // 3. 頂部雙層表頭
    if (hasTwoTierHeader) {
      let colCursor = 0;
      geneGroups.forEach((group) => {
        const groupColCount = group.columns.length;
        const gx = ROW_HEADER_W + colCursor * CELL_W;
        const gw = groupColCount * CELL_W;
        colCursor += groupColCount;

        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(gx, 0, gw, GENE_TIER_H);
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        ctx.strokeRect(gx, 0, gw, GENE_TIER_H);

        ctx.save();
        ctx.beginPath();
        ctx.rect(gx, 0, gw, GENE_TIER_H);
        ctx.clip();
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#111827';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(group.geneLabel, gx + gw / 2, GENE_TIER_H / 2);
        ctx.restore();
      });
    }

    // 第二層：突變點位（垂直文字）
    const mutationTierY = GENE_TIER_H;
    const mutationTierH = COL_HEADER_H - GENE_TIER_H;

    for (let c = 0; c < columns.length; c += 1) {
      const col = columns[c];
      const x = ROW_HEADER_W + c * CELL_W;

      ctx.fillStyle = '#f9fafb';
      ctx.fillRect(x, mutationTierY, CELL_W, mutationTierH);
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x, mutationTierY, CELL_W, mutationTierH);

      ctx.font = '600 11px sans-serif';
      ctx.fillStyle = '#374151';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.translate(x + CELL_W / 2 + 3, COL_HEADER_H - 8);
      ctx.rotate(-Math.PI / 2);
      const text = formatMutationDisplay(col.mutation || col.label || col.id);
      ctx.fillText(text, 0, 0, mutationTierH - 12);
      ctx.restore();
    }
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ROW_HEADER_W, COL_HEADER_H);
    ctx.lineTo(ROW_HEADER_W + columns.length * CELL_W, COL_HEADER_H);
    ctx.stroke();

    // 4. 左上角交叉區塊
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, 0, ROW_HEADER_W, COL_HEADER_H);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, ROW_HEADER_W, COL_HEADER_H);

    ctx.fillStyle = '#374151';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (hasTwoTierHeader) {
      ctx.fillText('基因 (參考序列)', 12, GENE_TIER_H / 2);
      ctx.strokeStyle = '#d1d5db';
      ctx.beginPath();
      ctx.moveTo(0, GENE_TIER_H);
      ctx.lineTo(ROW_HEADER_W, GENE_TIER_H);
      ctx.stroke();
      ctx.fillText('樣本名稱 \\ 點位', 12, GENE_TIER_H + mutationTierH / 2);
    } else {
      ctx.fillText('樣本 \\ 抗生素', 12, COL_HEADER_H / 2);
    }

    // 5. 懸浮點位外框
    if (hoveredCell && hoveredCell.rowIdx >= 0 && hoveredCell.colIdx >= 0) {
      const hx = ROW_HEADER_W + hoveredCell.colIdx * CELL_W;
      const hy = COL_HEADER_H + hoveredCell.rowIdx * CELL_H;
      ctx.strokeStyle = '#1e1b4b';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx, hy, CELL_W, CELL_H);
    }

    ctx.restore();
    ctx.restore();
  }, [columns, rows, viewState, hoveredCell, getCellColor, hasTwoTierHeader, geneGroups, COL_HEADER_H, GENE_TIER_H]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const dpr = window.devicePixelRatio || 1;
      const nw = entry.contentRect.width;
      const nh = entry.contentRect.height;
      if (nw > 0 && nh > 0) {
        canvas.width = nw * dpr;
        canvas.height = nh * dpr;
        canvas.style.width = `${nw}px`;
        canvas.style.height = `${nh}px`;
        renderCanvas();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [renderCanvas]);

  // 游標精確錨點縮放
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const handleWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;

      const currentView = viewStateRef.current;
      const minZ = Math.min(calculateFitWidthScale() * 0.5, 0.005);
      const newZoom = clamp(currentView.zoom * zoomFactor, minZ, 2.5);
      if (newZoom === currentView.zoom) return;

      const scaleRatio = newZoom / currentView.zoom;
      const newPanX = mouseX - (mouseX - currentView.panX) * scaleRatio;
      const newPanY = mouseY - (mouseY - currentView.panY) * scaleRatio;

      setViewState({
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY,
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [calculateFitWidthScale]);

  const handlePointerDown = (e) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: viewState.panX, panY: viewState.panY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setViewState((prev) => ({
        ...prev,
        panX: dragStartRef.current.panX + dx,
        panY: dragStartRef.current.panY + dy,
      }));
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const imageX = (mx - viewState.panX) / viewState.zoom;
    const imageY = (my - viewState.panY) / viewState.zoom;

    if (imageX >= ROW_HEADER_W && imageY >= COL_HEADER_H) {
      const colIdx = Math.floor((imageX - ROW_HEADER_W) / CELL_W);
      const rowIdx = Math.floor((imageY - COL_HEADER_H) / CELL_H);

      if (rowIdx >= 0 && rowIdx < rows.length && colIdx >= 0 && colIdx < columns.length) {
        const row = rows[rowIdx];
        const col = columns[colIdx];
        setHoveredCell({
          rowIdx,
          colIdx,
          clientX: e.clientX,
          clientY: e.clientY,
          row,
          col,
          info: getCellInfo(row, col),
        });
        return;
      }
    }
    setHoveredCell(null);
  };

  const handlePointerUp = (e) => {
    isDraggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div className="relative flex flex-col w-full border border-gray-200 rounded-2xl bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50/90 px-4 py-2 text-xs">
        <span className="font-bold text-gray-700">
          總量：{rows.length} 株 × {columns.length} 個標記點位
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFitWidth}
            title="自動縮放以符合畫布完整寬度"
            className="rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-2.5 py-1 hover:bg-indigo-100 transition shadow-sm"
          >
            🔍 最適寬度
          </button>
          <button
            type="button"
            onClick={() => zoomAtCenter(0.8)}
            title="以中心縮小"
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-100 shadow-sm"
          >
            -
          </button>
          <span className="min-w-14 text-center font-mono font-bold text-gray-700">
            {(viewState.zoom * 100).toFixed(viewState.zoom < 0.1 ? 1 : 0)}%
          </span>
          <button
            type="button"
            onClick={() => zoomAtCenter(1.25)}
            title="以中心放大"
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-100 shadow-sm"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setViewState({ zoom: 1, panX: 20, panY: 20 })}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-bold text-gray-700 hover:bg-gray-100 shadow-sm"
          >
            重置
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden bg-white cursor-grab active:cursor-grabbing select-none"
        style={{ height: '68vh', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { handlePointerUp(); setHoveredCell(null); }}
        onMouseEnter={() => onInteractionChange && onInteractionChange(true)}
        onMouseLeave={() => onInteractionChange && onInteractionChange(false)}
      >
        <canvas ref={canvasRef} className="block w-full h-full bg-white" />
      </div>

      {hoveredCell && (
        <div
          className="pointer-events-none fixed z-50 rounded-xl bg-gray-900/90 p-3 text-xs text-white shadow-2xl backdrop-blur-md border border-gray-700"
          style={{ left: hoveredCell.clientX + 14, top: hoveredCell.clientY + 14 }}
        >
          <div className="font-bold border-b border-gray-700 pb-1 mb-1.5 flex items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${hoveredCell.row.isQuery ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
              {hoveredCell.row.isQuery ? '本次查詢' : '資料庫'}
            </span>
            <span>{hoveredCell.row.label}</span>
          </div>
          <div className="space-y-0.5 text-gray-200">
            {hoveredCell.col.geneLabel && (
              <div>基因：<strong className="text-indigo-300">{hoveredCell.col.geneLabel}</strong></div>
            )}
            <div>位點 / 藥物：<strong className="text-amber-300">{formatMutationDisplay(hoveredCell.col.mutation || hoveredCell.col.label)}</strong></div>
            {hoveredCell.col.reference && (
              <div>參考序列：<span className="text-gray-300">{hoveredCell.col.reference}</span></div>
            )}
            <div>檢測結果：<strong>{hoveredCell.info.statusText}</strong></div>
          </div>
        </div>
      )}
    </div>
  );
};

// 安全掃描矩陣檔
const antibioticGlobModules = import.meta.glob(
  '/public/*_all_strains_antibiotics_matrix*',
  { query: '?raw', import: 'default' }
);
const mutationGlobModules = import.meta.glob(
  '/public/*_all_strains_mutations_matrix*',
  { query: '?raw', import: 'default' }
);

const PUBLIC_DATASET_STATS = { speciesCount: 1, sampleCount: 365 };
const DEFAULT_SPECIES_OPTIONS = ['Aspergillus fumigatus'];

function App() {
  const [page, setPage] = useState('home');
  const [stats, setStats] = useState({ speciesCount: 0, sampleCount: 0 });
  const [uploadId, setUploadId] = useState('');
  const [speciesOptions, setSpeciesOptions] = useState(DEFAULT_SPECIES_OPTIONS);
  const [uploadNotice, setUploadNotice] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchData, setSearchData] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [resultTab, setResultTab] = useState('overview');
  const [isZoomAreaActive, setIsZoomAreaActive] = useState(false);

  const [detectedMatrixDate, setDetectedMatrixDate] = useState('自動偵測中...');
  const [dbAntibioticRecords, setDbAntibioticRecords] = useState([]);
  const [dbMutationRecords, setDbMutationRecords] = useState([]);
  const [dbMutationKeys, setDbMutationKeys] = useState([]);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixLoadError, setMatrixLoadError] = useState(null);

  // BioSample 資料狀態
  const [biosamples, setBiosamples] = useState([]);
  const displayedStats = stats.sampleCount > 0 ? stats : PUBLIC_DATASET_STATS;

  // 參考序列過濾與統計面板展開狀態
  const [selectedReference, setSelectedReference] = useState('');
  const [showRefStatsModal, setShowRefStatsModal] = useState(false);

  const [viewFilter, setViewFilter] = useState('all');
  const [strainKeyword, setStrainKeyword] = useState('');
  const [similarSearchKeyword, setSimilarSearchKeyword] = useState('');

  // 1. 純淨自動讀取 public/Aspergillus_fumigatus_biosample.json
  useEffect(() => {
    fetch('./Aspergillus_fumigatus_biosample.json')
      .then((res) => {
        if (!res.ok) throw new Error('無法讀取 /Aspergillus_fumigatus_biosample.json');
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setBiosamples(data);
        }
      })
      .catch((err) => {
        console.warn('自動讀取 Aspergillus_fumigatus_biosample.json 略過或失敗:', err);
      });
  }, []);

  // 2. 自動尋找最新矩陣檔案
  const loadLatestMatrix = async () => {
    setMatrixLoading(true);
    setMatrixLoadError(null);

    try {
      const abKeys = Object.keys(antibioticGlobModules).sort();
      let abText = '';
      let latestDateStr = '';

      if (abKeys.length > 0) {
        const latestAbKey = abKeys[abKeys.length - 1];
        const filename = latestAbKey.split('/').pop();
        const dateMatch = filename.match(/\d{4}\.\d{2}\.\d{2}/);
        latestDateStr = dateMatch ? dateMatch[0] : '最新';
        const loader = antibioticGlobModules[latestAbKey];
        abText = typeof loader === 'function' ? await loader() : loader;
      }

      if (isValidCSV(abText)) {
        const { headers, rows } = parseCSV(abText);
        const strainCol = headers[0];
        const drugCols = headers.slice(1);
        const parsedAb = rows.map((r) => {
          const strainId = r[strainCol];
          const resistantDrugs = new Set();
          drugCols.forEach((d) => {
            const val = (r[d] || '').trim().toLowerCase();
            if (val === '1' || val === 'r' || val === 'resistant' || val === 'true') {
              resistantDrugs.add(d.toLowerCase());
            }
          });
          return { id: strainId, label: strainId, resistantDrugs, isQuery: false };
        });
        setDbAntibioticRecords(parsedAb);
      } else {
        setDbAntibioticRecords([]);
      }

      const mutKeys = Object.keys(mutationGlobModules).sort();
      let mutText = '';

      if (mutKeys.length > 0) {
        const latestMutKey = mutKeys[mutKeys.length - 1];
        const filename = latestMutKey.split('/').pop();
        if (!latestDateStr) {
          const dateMatch = filename.match(/\d{4}\.\d{2}\.\d{2}/);
          latestDateStr = dateMatch ? dateMatch[0] : '最新';
        }
        const loader = mutationGlobModules[latestMutKey];
        mutText = typeof loader === 'function' ? await loader() : loader;
      }

      if (isValidCSV(mutText)) {
        const { headers, rows } = parseCSV(mutText);
        const strainCol = headers[0];
        const mutCols = headers.slice(1);
        setDbMutationKeys(mutCols);

        const parsedMut = rows.map((r) => {
          const strainId = r[strainCol];
          const mutations = new Set();
          mutCols.forEach((m) => {
            const val = (r[m] || '').trim().toLowerCase();
            if (val === '1' || val === 'r' || val === 'true' || val === 'mutation') {
              mutations.add(m);
            }
          });
          return { id: strainId, label: strainId, mutations, isQuery: false };
        });
        setDbMutationRecords(parsedMut);
      } else {
        setDbMutationRecords([]);
        setDbMutationKeys([]);
      }

      if (latestDateStr) {
        setDetectedMatrixDate(latestDateStr);
      } else {
        setDetectedMatrixDate('未找到檔案');
        setMatrixLoadError('public/ 資料夾未找到 20XX.XX.XX 矩陣檔案，目前僅顯示本次查詢樣本。');
      }
    } catch (err) {
      console.error('載入矩陣檔案失敗:', err);
      setMatrixLoadError('載入矩陣時發生錯誤。');
    } finally {
      setMatrixLoading(false);
    }
  };

  useEffect(() => { loadLatestMatrix(); }, []);

  const fetchStats = () => {
    fetch('/api/stats').then((res) => res.json()).then(setStats).catch((err) => console.error('無法取得數據:', err));
  };

  useEffect(() => { fetchStats(); }, [page]);
  useEffect(() => {
    fetch('/api/species')
      .then((res) => {
        if (!res.ok) throw new Error(`無法讀取物種清單 (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const apiSpecies = Array.isArray(data?.species)
          ? data.species.filter((species) => typeof species === 'string' && species.trim()).map((species) => species.trim())
          : [];
        if (apiSpecies.length > 0) {
          setSpeciesOptions([...new Set([...DEFAULT_SPECIES_OPTIONS, ...apiSpecies])]);
        }
      })
      .catch((err) => console.warn('無法讀取物種清單，使用內建菌種清單:', err));
  }, []);

  // 深入解析各個 Reference 的突變點位清單與數量統計
  const cyp51aRefDetails = useMemo(() => {
    const map = new Map();

    dbMutationKeys.forEach((key) => {
      const { gene, mutation, reference } = parseMutationHeader(key);
      if (gene === 'Cyp51A' && reference) {
        if (!map.has(reference)) map.set(reference, new Set());
        if (!isTR34(mutation)) {
          map.get(reference).add(mutation);
        }
      }
    });

    (searchData?.resistanceRecords || []).forEach((r) => {
      if (normalizeGeneName(r.gene) === 'Cyp51A' && r.reference) {
        const ref = r.reference.trim();
        if (!map.has(ref)) map.set(ref, new Set());
        (r.mutationSites || []).forEach((m) => {
          const norm = normalizeMutation(m);
          if (norm && !isTR34(norm)) {
            map.get(ref).add(norm);
          }
        });
      }
    });

    return [...map.entries()].map(([ref, mutSet]) => {
      const list = [...mutSet].sort((a, b) => {
        const na = getMutationOrderValue(a);
        const nb = getMutationOrderValue(b);
        return na !== nb ? na - nb : a.localeCompare(b);
      });
      return {
        reference: ref,
        count: list.length,
        mutations: list,
      };
    }).sort((a, b) => b.count - a.count);
  }, [dbMutationKeys, searchData?.resistanceRecords]);

  const cyp51aReferences = useMemo(() => {
    return cyp51aRefDetails.map((item) => item.reference);
  }, [cyp51aRefDetails]);

  useEffect(() => {
    if (cyp51aReferences.length > 0 && !selectedReference) {
      const reportRef = (searchData?.resistanceRecords || []).find((r) => normalizeGeneName(r.gene) === 'Cyp51A')?.reference?.trim();
      if (reportRef && cyp51aReferences.includes(reportRef)) {
        setSelectedReference(reportRef);
      } else if (cyp51aReferences.includes('Q9P8R0')) {
        setSelectedReference('Q9P8R0');
      } else {
        setSelectedReference(cyp51aReferences[0]);
      }
    }
  }, [cyp51aReferences, selectedReference, searchData?.resistanceRecords]);

  // 建立當前選定參考序列的 Cyp51A 欄位
  const mutationColumns = useMemo(
    () => buildMutationColumns(searchData?.resistanceRecords || [], dbMutationKeys, selectedReference),
    [searchData?.resistanceRecords, dbMutationKeys, selectedReference]
  );

  const geneGroups = useMemo(() => {
    const groups = new Map();
    mutationColumns.forEach((column) => {
      const gLabel = column.geneLabel || 'Cyp51A';
      if (!groups.has(gLabel)) {
        groups.set(gLabel, { geneLabel: gLabel, columns: [] });
      }
      groups.get(gLabel).columns.push(column);
    });
    return [...groups.values()];
  }, [mutationColumns]);

  const antibioticColumns = useMemo(
    () => ANTIBIOTIC_LIST.map((drug) => ({ id: drug, label: drug, mutation: drug })),
    []
  );

  // 1. 總覽專用：僅保留 Cyp51A，並嚴格依 Reference_Sequence > Mutation_Combination > Resistant_Drugs 排序
  const cyp51aResistanceRecords = useMemo(() => {
    const list = (searchData?.resistanceRecords || []).filter(
      (record) => normalizeGeneName(record.gene) === 'Cyp51A'
    );

    return list.slice().sort((a, b) => {
      // 1. Reference_Sequence 排序
      const refA = (a.reference || '').trim();
      const refB = (b.reference || '').trim();
      const refDiff = refA.localeCompare(refB, 'en', { numeric: true, sensitivity: 'base' });
      if (refDiff !== 0) return refDiff;

      // 2. Mutation_Combination 排序
      const combA = (a.mutationCombination || '').trim();
      const combB = (b.mutationCombination || '').trim();
      const combDiff = combA.localeCompare(combB, 'en', { numeric: true, sensitivity: 'base' });
      if (combDiff !== 0) return combDiff;

      // 3. Resistant_Drugs 排序
      const drugsA = Array.isArray(a.resistantDrugs) ? a.resistantDrugs.join(', ') : (a.resistantDrugs || '');
      const drugsB = Array.isArray(b.resistantDrugs) ? b.resistantDrugs.join(', ') : (b.resistantDrugs || '');
      return drugsA.localeCompare(drugsB, 'en', { numeric: true, sensitivity: 'base' });
    });
  }, [searchData?.resistanceRecords]);

  const otherResistanceRecords = useMemo(
    () => (searchData?.resistanceRecords || []).filter(
      (record) => normalizeGeneName(record.gene) !== 'Cyp51A'
    ),
    [searchData?.resistanceRecords]
  );

  const queryRows = useMemo(() => {
    if (!searchData) return [];
    const fileList = searchData.fileList || [];

    const reportSamples = [...new Set(
      (searchData.resistanceRecords || []).map((record) => record.sampleName).filter(Boolean)
    )];
    const sampleLabels = reportSamples.length
      ? reportSamples
      : fileList
        .filter((fileName) => !/_resistance_report.*\.(csv|tsv)$/i.test(fileName))
        .map((fileName) => fileName.replace(/\.[^.]+$/, ''));
    if (sampleLabels.length === 0 && searchData.ncbiAccession) {
      sampleLabels.push(searchData.ncbiAccession);
    }

    return sampleLabels.map((label) => ({
      id: label,
      label,
      isQuery: true,
    }));
  }, [searchData]);

  const sampleMutationMap = useMemo(() => {
    const map = {};
    (searchData?.resistanceRecords || []).forEach((record) => {
      const g = normalizeGeneName(record.gene);
      const ref = record.reference ? record.reference.trim() : '';
      if (!map[record.sampleName]) {
        map[record.sampleName] = new Map();
      }
      (record.mutationSites || []).forEach((mutation) => {
        const normMut = normalizeMutation(mutation);
        map[record.sampleName].set(`${g}::${ref}::${normMut}`, record.resistantDrugs || []);
        map[record.sampleName].set(`${g}::${normMut}`, record.resistantDrugs || []);
        map[record.sampleName].set(normMut, record.resistantDrugs || []);
      });
    });
    return map;
  }, [searchData]);

  const sampleAntibioticMap = useMemo(() => {
    const map = {};
    (searchData?.resistanceRecords || []).forEach((record) => {
      const sample = record.sampleName;
      if (!sample) return;
      if (!map[sample]) map[sample] = new Set();
      (record.resistantDrugs || []).forEach((drug) => {
        if (drug) map[sample].add(drug.trim().toLowerCase());
      });
    });
    return map;
  }, [searchData]);

  const combinedMutationRows = useMemo(() => {
    let rows = [];
    if (viewFilter === 'all' || viewFilter === 'query') rows = rows.concat(queryRows);
    if (viewFilter === 'all' || viewFilter === 'database') rows = rows.concat(dbMutationRecords);
    if (strainKeyword.trim()) {
      const kw = strainKeyword.trim().toLowerCase();
      rows = rows.filter((r) => r.label.toLowerCase().includes(kw));
    }
    return rows;
  }, [queryRows, dbMutationRecords, viewFilter, strainKeyword]);

  const combinedAntibioticRows = useMemo(() => {
    let rows = [];
    if (viewFilter === 'all' || viewFilter === 'query') rows = rows.concat(queryRows);
    if (viewFilter === 'all' || viewFilter === 'database') rows = rows.concat(dbAntibioticRecords);
    if (strainKeyword.trim()) {
      const kw = strainKeyword.trim().toLowerCase();
      rows = rows.filter((r) => r.label.toLowerCase().includes(kw));
    }
    return rows;
  }, [queryRows, dbAntibioticRecords, viewFilter, strainKeyword]);

  // ==================== 100% 依據 Aspergillus_fumigatus_biosample.json 更新三張地圖分布統計 ====================
  const mapCountryStats = useMemo(() => {
    const mergedList = [];

    const drugByStrainMap = new Map();
    dbAntibioticRecords.forEach((r) => {
      if (r.id) drugByStrainMap.set(r.id.toLowerCase().trim(), r.resistantDrugs);
      if (r.label) drugByStrainMap.set(r.label.toLowerCase().trim(), r.resistantDrugs);
    });

    biosamples.forEach((item) => {
      const location = item.geo_loc_name || item.country || '';
      const country = parseCountryFromLocation(location);
      if (!country) return;

      const year = parseYearFromDate(item.collection_date || item['collection-date'] || '');
      const strainId = item.strain || item.isolate || item.AssemblyAccession || item['sample name'] || 'Unknown';

      const queryKey = strainId.toLowerCase().trim();
      const accessionKey = (item.AssemblyAccession || '').toLowerCase().trim();
      const resistantDrugs = drugByStrainMap.get(queryKey) || drugByStrainMap.get(accessionKey) || new Set();

      if (resistantDrugs.size > 0) {
        resistantDrugs.forEach((drugLower) => {
          const matchedDrug = RAW_ANTIBIOTIC_LIST.find((d) => d.toLowerCase() === drugLower) || drugLower;
          mergedList.push({
            country,
            year,
            drug: matchedDrug,
            strainIds: [strainId],
          });
        });
      } else {
        mergedList.push({
          country,
          year,
          drug: '敏感 / 未檢出抗藥性',
          strainIds: [strainId],
        });
      }
    });

    return buildCountryStatistics(mergedList);
  }, [biosamples, dbAntibioticRecords]);

  // ==================== 2. 相似樣本：深層連結 BioSample、Assembly、抗生素矩陣與突變矩陣 ====================
  const fullLinkedSamples = useMemo(() => {
    // 1. 建立抗生素矩陣索引
    const drugByStrainMap = new Map();
    dbAntibioticRecords.forEach((r) => {
      if (r.id) drugByStrainMap.set(r.id.toLowerCase().trim(), r.resistantDrugs);
      if (r.label) drugByStrainMap.set(r.label.toLowerCase().trim(), r.resistantDrugs);
    });

    // 2. 建立突變矩陣索引（提取該菌株的 Cyp51A 點位）
    const mutationByStrainMap = new Map();
    dbMutationRecords.forEach((r) => {
      const cypMutations = [];
      (r.mutations || new Set()).forEach((rawMut) => {
        const parsed = parseMutationHeader(rawMut);
        if (parsed.gene === 'Cyp51A' && !isTR34(parsed.mutation)) {
          cypMutations.push(parsed.mutation);
        }
      });
      // 依位點數字排序
      cypMutations.sort((a, b) => getMutationOrderValue(a) - getMutationOrderValue(b));

      if (r.id) mutationByStrainMap.set(r.id.toLowerCase().trim(), cypMutations);
      if (r.label) mutationByStrainMap.set(r.label.toLowerCase().trim(), cypMutations);
    });

    // 3. 完整對接 BioSample 的每株菌株
    return biosamples.map((item) => {
      const location = item.geo_loc_name || item.country || '地點未提供';
      const year = parseYearFromDate(item.collection_date || item['collection-date'] || '');
      const strainId = item.strain && !/missing|not applicable|NA/i.test(item.strain)
        ? item.strain
        : item.isolate && !/missing|not applicable|NA/i.test(item.isolate)
          ? item.isolate
          : item.AssemblyAccession || 'Unknown';

      const queryKey = strainId.toLowerCase().trim();
      const accessionKey = (item.AssemblyAccession || '').toLowerCase().trim();

      // 比對抗藥性
      const resistantDrugs = drugByStrainMap.get(queryKey) || drugByStrainMap.get(accessionKey) || new Set();

      // 比對 Cyp51A 突變
      const mutations = mutationByStrainMap.get(queryKey) || mutationByStrainMap.get(accessionKey) || [];

      return {
        strainId,
        assemblyAccession: item.AssemblyAccession || '—',
        bioSampleAccession: item.BioSampleAccession || '—',
        year: year === '未知' ? '未知' : year,
        location: location.replace(/\b(missing|not applicable|NA)\b/i, '地點未提供'),
        host: item.host && !/missing|not applicable|NA/i.test(item.host) ? item.host : '—',
        hostDisease: item.host_disease && !/missing|not applicable|NA/i.test(item.host_disease) ? item.host_disease : '—',
        mutations: mutations.length > 0 ? mutations.join(', ') : '野生型 (WT) / 未檢出',
        hasResistantMutation: mutations.length > 0,
        drugs: resistantDrugs.size > 0
          ? [...resistantDrugs].map((d) => RAW_ANTIBIOTIC_LIST.find((a) => a.toLowerCase() === d) || d).join(', ')
          : '敏感 / 未檢出抗藥性',
        isResistant: resistantDrugs.size > 0,
      };
    });
  }, [biosamples, dbAntibioticRecords, dbMutationRecords]);

  // 相似樣本即時搜尋過濾
  const filteredSimilarSamples = useMemo(() => {
    if (!similarSearchKeyword.trim()) return fullLinkedSamples;
    const kw = similarSearchKeyword.trim().toLowerCase();
    return fullLinkedSamples.filter((sample) =>
      sample.strainId.toLowerCase().includes(kw) ||
      sample.assemblyAccession.toLowerCase().includes(kw) ||
      sample.bioSampleAccession.toLowerCase().includes(kw) ||
      sample.location.toLowerCase().includes(kw) ||
      sample.mutations.toLowerCase().includes(kw) ||
      sample.drugs.toLowerCase().includes(kw)
    );
  }, [fullLinkedSamples, similarSearchKeyword]);

  // 未能定位的真實樣本數
  const unlocalizedBioSampleCount = useMemo(() => {
    return biosamples.filter((item) => {
      const location = item.geo_loc_name || item.country || '';
      return !parseCountryFromLocation(location);
    }).length;
  }, [biosamples]);

  const getMutationCellColor = useCallback((row, column) => {
    if (row.isQuery) {
      const sampleMutations = sampleMutationMap[row.label] || new Map();
      const fullKey = `${column.gene}::${column.reference}::${column.mutation}`;
      const geneKey = `${column.gene}::${column.mutation}`;
      const hasMutation = sampleMutations.has(fullKey) || sampleMutations.has(geneKey) || sampleMutations.has(column.mutation);
      const resistantDrugs = sampleMutations.get(fullKey) || sampleMutations.get(geneKey) || sampleMutations.get(column.mutation) || [];
      return resistantDrugs.length > 0 ? '#ef4444' : hasMutation ? '#f59e0b' : '#10b981';
    }
    const hasMutation = row.mutations ? (row.mutations.has(column.id) || row.mutations.has(column.rawKey) || row.mutations.has(column.mutation)) : false;
    return hasMutation ? '#ef4444' : '#10b981';
  }, [sampleMutationMap]);

  const getMutationCellInfo = useCallback((row, column) => {
    if (row.isQuery) {
      const sampleMutations = sampleMutationMap[row.label] || new Map();
      const fullKey = `${column.gene}::${column.reference}::${column.mutation}`;
      const geneKey = `${column.gene}::${column.mutation}`;
      const hasMutation = sampleMutations.has(fullKey) || sampleMutations.has(geneKey) || sampleMutations.has(column.mutation);
      const resistantDrugs = sampleMutations.get(fullKey) || sampleMutations.get(geneKey) || sampleMutations.get(column.mutation) || [];
      const isResistant = resistantDrugs.length > 0;
      return {
        statusText: isResistant ? `具抗藥性 (藥物: ${resistantDrugs.join(', ')})` : hasMutation ? '有突變 (未標示抗藥性)' : '未檢測到突變',
      };
    }
    const hasMutation = row.mutations ? (row.mutations.has(column.id) || row.mutations.has(column.rawKey) || row.mutations.has(column.mutation)) : false;
    return {
      statusText: hasMutation ? '資料庫標記具突變/耐藥' : '未檢測到突變',
    };
  }, [sampleMutationMap]);

  const getAntibioticCellColor = useCallback((row, column) => {
    const sampleDrugs = row.isQuery ? (sampleAntibioticMap[row.label] || new Set()) : (row.resistantDrugs || new Set());
    const drugLower = column.label.toLowerCase().trim();
    let isResistant = sampleDrugs.has(drugLower);
    if (!isResistant && drugLower === 'azole(s)') {
      isResistant = sampleDrugs.has('azole') || sampleDrugs.has('azoles');
    }
    return isResistant ? '#ef4444' : '#10b981';
  }, [sampleAntibioticMap]);

  const getAntibioticCellInfo = useCallback((row, column) => {
    const sampleDrugs = row.isQuery ? (sampleAntibioticMap[row.label] || new Set()) : (row.resistantDrugs || new Set());
    const drugLower = column.label.toLowerCase().trim();
    let isResistant = sampleDrugs.has(drugLower);
    if (!isResistant && drugLower === 'azole(s)') {
      isResistant = sampleDrugs.has('azole') || sampleDrugs.has('azoles');
    }
    return {
      statusText: isResistant ? '具抗藥性' : '未檢出抗藥性 / 敏感',
    };
  }, [sampleAntibioticMap]);

  const handleUpload = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const hasFile = Boolean(form.elements.geneFile.files[0]);
    const hasAccession = Boolean(form.elements.ncbiAccession.value.trim());
    if (!hasFile && !hasAccession) {
      setUploadNotice({ type: 'error', message: '上傳檔案與 NCBI 序號至少需填寫一項。' });
      return;
    }

    setIsUploading(true);
    setUploadNotice(null);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setUploadNotice({ type: 'error', message: data.message || '提交失敗，請稍後再試。' });
        return;
      }

      setUploadId(data.trackingId);
      setUploadNotice({
        type: data.emailSent ? 'success' : 'warning',
        message: data.emailSent
          ? `收件確認信已寄至 ${form.elements.email.value.trim()}。`
          : data.emailConfigured
            ? '資料已成功提交，但確認信寄送失敗，請聯絡管理員。'
            : '資料已成功提交；系統尚未設定郵件服務，因此未寄出確認信。',
      });
      form.reset();
      fetchStats();
    } catch (err) {
      setUploadNotice({ type: 'error', message: '提交失敗，請檢查後端連線。' });
    } finally {
      setIsUploading(false);
    }
  };

  const openDemoResult = () => {
    setSearchData(DEMO_QUERY_DATA);
    setSelectedFile(null);
    setResultTab('overview');
    setPage('result');
  };

  const handleSearch = async () => {
    const query = searchInput.trim();
    if (!query) return;
    if (query.toUpperCase() === DEMO_QUERY_DATA.id.toUpperCase()) {
      openDemoResult();
      return;
    }

    try {
      const res = await fetch(`/api/query/${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.success) {
        setSearchData(data.data);
        setSelectedFile(null);
        setResultTab('overview');
        setPage('result');
      } else {
        alert('找不到此序號，請確認格式：FG-YYYYMMDD-HHMMSS-XXXX');
      }
    } catch (err) {
      alert('查詢發生錯誤');
    }
  };

  const renderHeatmapToolbar = (totalCount, queryCount, dbCount) => (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 border-b border-gray-200 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold text-gray-700">篩選來源：</span>
        <button
          type="button"
          onClick={() => setViewFilter('all')}
          className={`px-2.5 py-1 rounded-md font-semibold ${viewFilter === 'all' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
        >
          全部 ({totalCount})
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('query')}
          className={`px-2.5 py-1 rounded-md font-semibold ${viewFilter === 'query' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
        >
          本次查詢 ({queryCount})
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('database')}
          className={`px-2.5 py-1 rounded-md font-semibold ${viewFilter === 'database' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
        >
          資料庫 ({dbCount})
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={strainKeyword}
          onChange={(e) => setStrainKeyword(e.target.value)}
          placeholder="搜尋樣本名稱..."
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs outline-none focus:border-indigo-500 shadow-sm"
        />
        <div className="flex items-center gap-2 border-l border-gray-300 pl-3">
          <span className="font-semibold text-gray-600">
            資料庫版本: <strong className="text-indigo-600">{detectedMatrixDate}</strong>
          </span>
          <button
            type="button"
            onClick={loadLatestMatrix}
            disabled={matrixLoading}
            className="rounded bg-gray-200 px-2 py-0.5 font-bold hover:bg-gray-300 disabled:opacity-50"
          >
            {matrixLoading ? '載入中' : '重新整理'}
          </button>
        </div>
      </div>
    </div>
  );

  const renderResultPage = () => {
    if (!searchData) {
      return (
        <div className="w-full p-8 text-center text-gray-500">
          請先輸入序號進行查詢。
        </div>
      );
    }

    return (
      <div className="w-full min-w-0">
        <div className="w-full min-w-0">
          <div className="bg-gray-50 px-8 py-5 border-b border-gray-200 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500">Query</p>
              <p className="font-mono text-xl font-black text-gray-800">{searchData.id}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage('query')}
                className="text-indigo-600 font-bold hover:text-indigo-700"
              >
                ← 返回查詢
              </button>
            </div>
          </div>

          <div className="p-8">
            <div className="mb-8 flex flex-wrap gap-2 border-b border-gray-200 pb-4">
              {RESULT_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setIsZoomAreaActive(false); setResultTab(tab.key); }}
                  className={`px-5 py-2.5 rounded-xl font-semibold transition ${
                    resultTab === tab.key
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 1. 總覽頁面：嚴格依 Reference_Sequence > Mutation_Combination > Resistant_Drugs 排序 */}
            {resultTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="bg-indigo-50 rounded-2xl p-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">批次狀態</p>
                    <p className="mt-3 text-3xl font-black text-indigo-900">{searchData.status || '已收到'}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-2xl p-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">上傳時間</p>
                    <p className="mt-3 text-base font-bold text-emerald-900">{new Date(searchData.timestamp).toLocaleString()}</p>
                  </div>
                </div>

                <section>
                  <div className="mb-3 flex items-end justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">抗藥性報告（Cyp51A）</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {cyp51aResistanceRecords.length} 筆報告資料（已依 Reference_Sequence $\rightarrow$ Mutation_Combination $\rightarrow$ Resistant_Drugs 排序）
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto border-y border-gray-200">
                    <table className="w-full min-w-[1000px] border-collapse text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                        <tr>
                          <th className="border-b border-gray-200 px-3 py-3">Gene_Name</th>
                          <th className="border-b border-gray-200 px-3 py-3">Reference_Sequence</th>
                          <th className="border-b border-gray-200 px-3 py-3">Mutation_Combination</th>
                          <th className="border-b border-gray-200 px-3 py-3">Mutation_Site</th>
                          <th className="border-b border-gray-200 px-3 py-3">Resistant_Drugs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cyp51aResistanceRecords.map((record, index) => (
                          <tr key={`${record.sampleName}-${record.gene}-${record.reference}-${record.mutationCombination}-${index}`} className="align-top even:bg-gray-50/60">
                            <td className="border-b border-gray-100 px-3 py-3 font-semibold text-gray-800">{record.gene || '—'}</td>
                            <td className="border-b border-gray-100 px-3 py-3 font-mono text-gray-700">{record.reference || '—'}</td>
                            <td className="border-b border-gray-100 px-3 py-3 text-gray-700 font-semibold">{formatMutationDisplay(record.mutationCombination) || 'None'}</td>
                            <td className="border-b border-gray-100 px-3 py-3 text-gray-700">{formatMutationDisplay(record.mutationSite) || 'None'}</td>
                            <td className="border-b border-gray-100 px-3 py-3 text-gray-700 font-medium text-red-600">
                              {Array.isArray(record.resistantDrugs) ? record.resistantDrugs.join(', ') : record.resistantDrugs || 'None'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {otherResistanceRecords.length > 0 && (
                  <section>
                    <div className="mb-3">
                      <h3 className="text-lg font-bold text-gray-800">其他基因分析結果</h3>
                      <p className="mt-1 text-sm text-gray-500">{otherResistanceRecords.length} 筆報告資料</p>
                    </div>
                    <div className="overflow-x-auto border-y border-gray-200">
                      <table className="w-full min-w-[900px] border-collapse text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                          <tr>
                            <th className="border-b border-gray-200 px-3 py-3">Gene_Name</th>
                            <th className="border-b border-gray-200 px-3 py-3">Reference_Sequence</th>
                            <th className="border-b border-gray-200 px-3 py-3">Mutation_Site</th>
                            <th className="border-b border-gray-200 px-3 py-3">Confidence_Score</th>
                            <th className="border-b border-gray-200 px-3 py-3">Resistant_Drugs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {otherResistanceRecords.map((record, index) => (
                            <tr key={`${record.gene}-${record.reference}-${index}`} className="align-top even:bg-gray-50/60">
                              <td className="border-b border-gray-100 px-3 py-3 font-semibold text-gray-800">{record.gene || '—'}</td>
                              <td className="border-b border-gray-100 px-3 py-3 font-mono text-gray-700">{record.reference || '—'}</td>
                              <td className="border-b border-gray-100 px-3 py-3 text-gray-700">{formatMutationDisplay(record.mutationSite) || 'None'}</td>
                              <td className="border-b border-gray-100 px-3 py-3 text-gray-700">{record.confidenceScore ?? '—'}</td>
                              <td className="border-b border-gray-100 px-3 py-3 text-gray-700 font-medium text-red-600">
                                {Array.isArray(record.resistantDrugs) ? record.resistantDrugs.join(', ') : record.resistantDrugs || 'None'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* 抗藥基因圖譜 */}
            {resultTab === 'drug' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-xl font-black text-gray-800">抗藥圖譜（Cyp51A 突變）</h3>
                    <p className="text-sm text-gray-500">
                      整合本次樣本與最新資料庫矩陣（版本：{detectedMatrixDate}）｜依點位編號數字嚴格排序｜TR34 點位不單獨顯示
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-semibold text-gray-600">
                    <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-500 inline-block"></span> 紅色 = 檢測到突變/抗藥</span>
                    <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-400 inline-block"></span> 黃色 = 有突變未標抗藥</span>
                    <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span> 綠色 = 未檢出</span>
                  </div>
                </div>

                {/* 參考序列切換列與位點統計展開按鈕 */}
                <div className="flex items-center justify-between flex-wrap gap-2 bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 rounded-xl text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-indigo-900">Cyp51A 參考序列 (Reference)：</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {cyp51aReferences.map((ref) => (
                        <button
                          key={ref}
                          type="button"
                          onClick={() => setSelectedReference(ref)}
                          className={`px-3 py-1 rounded-lg font-bold transition ${
                            selectedReference === ref
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {ref}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 ml-auto">
                    <button
                      type="button"
                      onClick={() => setShowRefStatsModal((v) => !v)}
                      className="px-2.5 py-1 rounded-md bg-white border border-indigo-200 text-indigo-700 font-bold hover:bg-indigo-50 shadow-sm"
                    >
                      📊 {showRefStatsModal ? '收起各 Reference 點位清單' : '查看各 Reference 點位清單與數量'}
                    </button>
                    <span className="text-gray-500">
                      目前顯示：<strong className="text-indigo-700">{selectedReference || '主要參考序列'}</strong>（共 {mutationColumns.length} 個位點）
                    </span>
                  </div>
                </div>

                {showRefStatsModal && (
                  <div className="p-4 bg-white border border-indigo-200 rounded-2xl shadow-sm text-xs space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <h4 className="font-black text-gray-800 text-sm">Cyp51A 各參考序列（Reference）收錄突變位點明細</h4>
                      <span className="text-gray-500">共收錄 {cyp51aRefDetails.length} 個不同參考序列（TR34 已過濾不列入計算）</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {cyp51aRefDetails.map((item) => (
                        <div key={item.reference} className={`p-3 rounded-xl border ${selectedReference === item.reference ? 'bg-indigo-50/50 border-indigo-300 ring-2 ring-indigo-200' : 'bg-gray-50 border-gray-200'}`}>
                          <div className="flex items-center justify-between mb-2 pb-1 border-b border-gray-200/80">
                            <span className="font-bold text-gray-800 text-xs font-mono">{item.reference}</span>
                            <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-black text-[11px]">
                              {item.count} 個位點
                            </span>
                          </div>
                          <div className="max-h-48 overflow-y-auto pr-1 text-[11px] leading-relaxed text-gray-600 font-mono flex flex-wrap gap-1">
                            {item.mutations.map((m) => (
                              <span key={m} className="inline-block bg-white border border-gray-200 px-1 py-0.5 rounded text-[10px]">
                                {formatMutationDisplay(m)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {matrixLoadError && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                    {matrixLoadError}
                  </div>
                )}

                {renderHeatmapToolbar(queryRows.length + dbMutationRecords.length, queryRows.length, dbMutationRecords.length)}

                <CanvasHeatmap
                  columns={mutationColumns}
                  rows={combinedMutationRows}
                  geneGroups={geneGroups}
                  getCellColor={getMutationCellColor}
                  getCellInfo={getMutationCellInfo}
                  onInteractionChange={setIsZoomAreaActive}
                />
              </div>
            )}

            {/* 抗生素圖譜 */}
            {resultTab === 'antibiotic' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-xl font-black text-gray-800">抗生素圖譜</h3>
                    <p className="text-sm text-gray-500">
                      整合本次樣本與最新抗生素矩陣（版本：{detectedMatrixDate}）｜抗生素依 A-Z 字母順序排列
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-semibold text-gray-600">
                    <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-500 inline-block"></span> 紅色 = 具抗藥性</span>
                    <span className="inline-flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span> 綠色 = 敏感 / 未檢出抗藥性</span>
                  </div>
                </div>

                {matrixLoadError && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                    {matrixLoadError}
                  </div>
                )}

                {renderHeatmapToolbar(queryRows.length + dbAntibioticRecords.length, queryRows.length, dbAntibioticRecords.length)}

                <CanvasHeatmap
                  columns={antibioticColumns}
                  rows={combinedAntibioticRows}
                  geneGroups={null}
                  getCellColor={getAntibioticCellColor}
                  getCellInfo={getAntibioticCellInfo}
                  onInteractionChange={setIsZoomAreaActive}
                />
              </div>
            )}

            {/* 2. 相似樣本：由 BioSample + Assembly + 抗生素耐藥 + Cyp51A 突變矩陣完整深層關聯 */}
            {resultTab === 'similar' && (
              <section>
                <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">資料庫相似菌株（完整資料庫跨表關聯）</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      已自動連結 BioSample 資訊、NCBI Assembly 序號、抗生素矩陣耐藥狀態與 Cyp51A 突變點位（共收錄 {biosamples.length} 株資料庫菌株）。
                    </p>
                  </div>
                  <div className="w-full md:w-72">
                    <input
                      type="text"
                      value={similarSearchKeyword}
                      onChange={(e) => setSimilarSearchKeyword(e.target.value)}
                      placeholder="快速搜尋菌株、GCA、地點、突變或藥物..."
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs outline-none focus:border-indigo-500 shadow-sm"
                    />
                  </div>
                </div>

                {filteredSimilarSamples.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    {biosamples.length === 0 ? '正在讀取 BioSample 資料庫中...' : '找不到符合關鍵字的菌株資料。'}
                  </p>
                ) : (
                  <div className="overflow-x-auto border-y border-gray-200">
                    <table className="w-full min-w-[1100px] border-collapse text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                        <tr>
                          <th className="border-b border-gray-200 px-3 py-3">Strain_ID</th>
                          <th className="border-b border-gray-200 px-3 py-3">Assembly Accession</th>
                          <th className="border-b border-gray-200 px-3 py-3">BioSample Accession</th>
                          <th className="border-b border-gray-200 px-3 py-3">採樣年份</th>
                          <th className="border-b border-gray-200 px-3 py-3">地點</th>
                          <th className="border-b border-gray-200 px-3 py-3">宿主 / 疾病</th>
                          <th className="border-b border-gray-200 px-3 py-3">Cyp51A 突變點位</th>
                          <th className="border-b border-gray-200 px-3 py-3">抗生素抗藥狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSimilarSamples.map((sample) => (
                          <tr key={`${sample.assemblyAccession}-${sample.strainId}`} className="align-top even:bg-gray-50/60 hover:bg-indigo-50/40 transition">
                            <td className="border-b border-gray-100 px-3 py-3 font-semibold text-gray-800 font-mono">
                              {sample.strainId}
                            </td>
                            <td className="border-b border-gray-100 px-3 py-3 font-mono text-xs">
                              {sample.assemblyAccession !== '—' ? (
                                <a
                                  href={`https://www.ncbi.nlm.nih.gov/assembly/${sample.assemblyAccession}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-1 font-semibold"
                                  title="在 NCBI Assembly 查看"
                                >
                                  {sample.assemblyAccession} ↗
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="border-b border-gray-100 px-3 py-3 font-mono text-xs">
                              {sample.bioSampleAccession !== '—' ? (
                                <a
                                  href={`https://www.ncbi.nlm.nih.gov/biosample/${sample.bioSampleAccession}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-1 font-semibold"
                                  title="在 NCBI BioSample 查看"
                                >
                                  {sample.bioSampleAccession} ↗
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="border-b border-gray-100 px-3 py-3">{sample.year}</td>
                            <td className="border-b border-gray-100 px-3 py-3">{sample.location}</td>
                            <td className="border-b border-gray-100 px-3 py-3">
                              {sample.host !== '—' ? (
                                <span>{sample.host}{sample.hostDisease !== '—' ? ` (${sample.hostDisease})` : ''}</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="border-b border-gray-100 px-3 py-3 text-xs font-mono">
                              <span className={sample.hasResistantMutation ? 'font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200' : 'text-gray-500'}>
                                {formatMutationDisplay(sample.mutations)}
                              </span>
                            </td>
                            <td className="border-b border-gray-100 px-3 py-3 text-xs">
                              <span className={sample.isResistant ? 'font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200' : 'text-emerald-700 font-semibold'}>
                                {sample.drugs}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* 地圖分布：100% 依據 Aspergillus_fumigatus_biosample.json 呈現 */}
            {resultTab === 'map' && (
              <div className="flex flex-col space-y-4">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                  <h4 className="font-bold text-gray-800 text-sm">全球菌株地理與年度抗藥分佈</h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    100% 純淨讀取 <code className="font-mono bg-white px-1.5 py-0.5 border border-gray-200 rounded text-indigo-700 font-bold">Aspergillus_fumigatus_biosample.json</code>（共 {biosamples.length} 株全球菌株），成功定位 {mapCountryStats.length} 個國家，已自動排除 {unlocalizedBioSampleCount} 筆無地點線索之菌株。
                  </p>
                </div>

                <WorldMapDemo
                  title="A：各國菌株時間分布統計"
                  accent="#0f766e"
                  chartMode="year"
                  markers={mapCountryStats}
                  onInteractionChange={setIsZoomAreaActive}
                />
                <WorldMapDemo
                  title="B：各國菌株抗生素藥物耐藥占比"
                  accent="#2563eb"
                  chartMode="drug-share"
                  markers={mapCountryStats}
                  onInteractionChange={setIsZoomAreaActive}
                />
                <WorldMapDemo
                  title="C：特定抗生素抗藥菌株年度趨勢統計"
                  accent="#c2410c"
                  chartMode="drug-year"
                  markers={mapCountryStats}
                  onInteractionChange={setIsZoomAreaActive}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Layout
      fullWidth={page === 'result'}
      lockMainScroll={isZoomAreaActive}
      onPageChange={(p) => { setIsZoomAreaActive(false); setPage(p); setSearchData(null); setSelectedFile(null); setResultTab('overview'); }}
    >
      {page === 'home' && (
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-8 text-gray-800">資料庫運行狀態</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white p-10 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
              <span className="text-5xl mb-4">🍄</span>
              <p className="text-gray-500 font-bold uppercase tracking-widest text-sm">Organism 種類</p>
              <p className="text-6xl font-black text-indigo-600 mt-4">{displayedStats.speciesCount}</p>
            </div>
            <div className="bg-white p-10 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center">
              <span className="text-5xl mb-4">📊</span>
              <p className="text-gray-500 font-bold uppercase tracking-widest text-sm">菌株總量</p>
              <p className="text-6xl font-black text-emerald-500 mt-4">{displayedStats.sampleCount}</p>
            </div>
          </div>
          <div className="mt-8 flex flex-col gap-4 rounded-3xl border border-indigo-100 bg-indigo-50 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-700">分析批次</p>
              <h3 className="mt-1 font-bold text-gray-800">{DEMO_QUERY_DATA.id}</h3>
              <p className="mt-1 text-sm text-gray-600">
                查看此批次的抗藥性分析結果。
              </p>
            </div>
            <button
              type="button"
              onClick={openDemoResult}
              className="shrink-0 rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white shadow-sm transition hover:bg-indigo-700"
            >
              查看分析結果
            </button>
          </div>
        </div>
      )}

      {page === 'upload' && (
        <div className="w-full max-w-4xl mx-auto py-8">
          <div className="mb-8 border-b border-gray-200 pb-5">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-700">Submission</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-800">提交樣本資料</h2>
          </div>
          <form onSubmit={handleUpload} className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-gray-700">Email <span className="text-red-600">*</span></span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder="name@example.com"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-gray-700">物種 <span className="text-red-600">*</span></span>
              <select
                name="species"
                required
                defaultValue=""
                disabled={speciesOptions.length === 0}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-100"
              >
                <option value="" disabled>{speciesOptions.length ? '選擇物種' : '載入物種清單中...'}</option>
                {speciesOptions.map((species) => <option key={species} value={species}>{species}</option>)}
              </select>
            </label>

            <div className="md:col-span-2 grid grid-cols-1 gap-4 rounded-xl border border-gray-200 p-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-gray-700">上傳檔案</span>
                <input
                  type="file"
                  name="geneFile"
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
                />
                <span className="mt-2 block text-xs text-gray-500">FASTA、序列或分析檔案</span>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-gray-700">NCBI 序號</span>
                <input
                  type="text"
                  name="ncbiAccession"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  placeholder="例如 GCA_000000000.1"
                />
                <span className="mt-2 block text-xs text-gray-500">檔案與 NCBI 序號至少填寫一項</span>
              </label>
            </div>

            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-gray-700">採集地點</span>
              <input
                type="text"
                name="collectionLocation"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                placeholder="國家、城市或採集地點"
              />
            </label>

            <div className="md:col-span-2 flex flex-col gap-4 border-t border-gray-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500"><span className="text-red-600">*</span> 為必填欄位；檔案與 NCBI 序號擇一即可。</p>
              <button
                type="submit"
                disabled={isUploading || speciesOptions.length === 0}
                className="rounded-lg bg-indigo-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? '提交中...' : '提交並取得序號'}
              </button>
            </div>
          </form>

          {uploadNotice && (
            <div className={`mt-6 border-l-4 p-4 text-sm ${uploadNotice.type === 'error' ? 'border-red-600 bg-red-50 text-red-800' : uploadNotice.type === 'warning' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-emerald-600 bg-emerald-50 text-emerald-900'}`} role="status">
              {uploadNotice.message}
            </div>
          )}

          {uploadId && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <p className="text-sm font-semibold text-gray-700">上傳序號</p>
              <p className="mt-2 break-all font-mono text-2xl font-black text-indigo-700">{uploadId}</p>
            </div>
          )}
        </div>
      )}

      {page === 'query' && (
        <div className="max-w-5xl mx-auto">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 mb-8 flex gap-4">
            <input
              className="flex-1 border border-gray-200 rounded-xl px-4 py-3 font-mono focus:ring-2 focus:ring-indigo-500 outline-none text-lg"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="輸入序號 (FG-YYYYMMDD...)"
            />
            <button onClick={handleSearch} className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition">搜尋批次</button>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 text-gray-500 text-center">
            請輸入 Query，查詢後會自動切換到分析結果頁。
          </div>
        </div>
      )}

      {page === 'result' && renderResultPage()}
    </Layout>
  );
}

export default App;
