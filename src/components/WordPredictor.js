// src/components/WordPredictor.js
import React, { useState, useRef, useCallback, useEffect } from 'react';
import Papa from 'papaparse';
import axios from 'axios';

const BACKEND_URL = 'http://localhost:3001/predictions';

export const LANGUAGES = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English',  flag: '🇬🇧' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'es', label: 'Español',  flag: '🇪🇸' },
  { code: 'de', label: 'Deutsch',  flag: '🇩🇪' },
  { code: 'ar', label: 'العربية',  flag: '🇹🇳' },
];

// Cache CSV (inchangé)
let csvSymbols = null;
let csvLoading = false;
let csvCallbacks = [];

function loadCSV(cb) {
  if (csvSymbols) { cb(csvSymbols); return; }
  csvCallbacks.push(cb);
  if (csvLoading) return;
  csvLoading = true;
  Papa.parse('/symbol-info.csv', {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: ({ data }) => {
      csvSymbols = data.filter(r => r['symbol-en']?.trim());
      csvCallbacks.forEach(fn => fn(csvSymbols));
      csvCallbacks = [];
    },
    error: () => {
      csvSymbols = [];
      csvCallbacks.forEach(fn => fn([]));
      csvCallbacks = [];
    },
  });
}

function findSymbol(symbols, word) {
  if (!word || symbols.length === 0) return null;
  const q = word.toLowerCase().trim();
  return (
    symbols.find(s => s['symbol-fr']?.toLowerCase().trim() === q) ||
    symbols.find(s => s['symbol-en']?.toLowerCase().trim() === q) ||
    symbols.find(s => s['symbol-fr']?.toLowerCase().trim().startsWith(q)) ||
    symbols.find(s => s['symbol-en']?.toLowerCase().trim().startsWith(q)) ||
    symbols.find(s => s['tags']?.toLowerCase().includes(q)) ||
    null
  );
}

function SymbolImage({ symbol, label }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [symbol]);

  if (!symbol) return <span style={styles.noSymbol}>?</span>;

  const symbolEn = symbol['symbol-en']?.trim();
  const symbolFr = symbol['symbol-fr']?.trim();
  const imgUrl   = `/EN-symbols/${symbolEn}.svg`;

  return (
    <div style={styles.symbolInner}>
      {!failed ? (
        <img
          src={imgUrl}
          alt={symbolFr || symbolEn}
          style={styles.symbolImg}
          onError={() => setFailed(true)}
        />
      ) : (
        <span style={styles.noSymbol}>?</span>
      )}
      <span style={styles.symbolLabel}>{label || symbolFr || symbolEn}</span>
    </div>
  );
}

export default function WordPredictor({ 
  fullText, 
  lastWord, 
  cursorBounds, 
  lang, 
  onSelectWord, 
  onAudition, 
  ttsLoading, 
  onReplaceText 
}) {
  const [words, setWords]           = useState([]);
  const [visible, setVisible]       = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [symbols, setSymbols]       = useState([]);
  const [activeTab, setActiveTab]   = useState(null);

  // Correction state
  const [correctedText, setCorrectedText] = useState('');
  const [isCorrecting, setIsCorrecting]   = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);

  const abortRef    = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => { loadCSV(data => setSymbols(data)); }, []);
  useEffect(() => { setHoveredIdx(null); }, [words]);

  // Prédiction de mots
  const fetchPredictions = useCallback(async (text, forcedLang) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(BACKEND_URL, {
        fullText: text.trim(),
        lang: forcedLang || null,
      }, {
        signal: abortRef.current.signal,
      });

      const cleaned = response.data
        .filter(w => typeof w === 'string' && w.length > 0 && w.length < 40)
        .slice(0, 8);

      setWords(cleaned);
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') return;
      console.error('[WordPredictor] Erreur:', err);
      setError(err.response?.status === 404
        ? 'Backend non trouvé (vérifie que NestJS tourne sur port 3001)'
        : 'Erreur de connexion au backend');
      setWords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fullText || fullText.trim().length < 2) {
      setWords([]);
      setVisible(false);
      setLoading(false);
      return;
    }

    setVisible(true);
    setLoading(true);
    setWords([]);

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPredictions(fullText.trim(), lang);
    }, 400);

    return () => clearTimeout(debounceRef.current);
  }, [fullText, lang, fetchPredictions]);

  // Correction grammaticale
  const handleCorrection = async () => {
    if (!fullText?.trim()) return;

    setIsCorrecting(true);
    setError(null);
    setCorrectedText('');
    setShowCorrection(false);

    try {
      const response = await axios.post('http://localhost:3001/correction', {
        text: fullText.trim(),
        lang: lang || 'fr',
      });

      const result = response.data.correctedText || response.data;
      setCorrectedText(result);
      setShowCorrection(true);
    } catch (err) {
      console.error(err);
      setError('Erreur lors de la correction. Vérifie que Ollama + Mistral sont lancés.');
    } finally {
      setIsCorrecting(false);
    }
  };

    // Appliquer la correction en cliquant sur le texte corrigé
  const applyCorrection = () => {
    if (!correctedText || !onReplaceText) return;

    let textToApply = correctedText.trim();

    // Supprimer tous les points à la fin (., .., ...)
    textToApply = textToApply.replace(/\.+$/, '').trim();
    onReplaceText(textToApply);
    
    // Réinitialiser pour permettre une nouvelle correction
    setShowCorrection(false);
    setCorrectedText('');
    setActiveTab(null);
  };

  if (!visible) return null;

  const top  = (cursorBounds?.bottom || 0) + 50;
  const left = Math.min((cursorBounds?.left || 0) + 16, window.innerWidth - 460);
  const currentLang = lang ? LANGUAGES.find(l => l.code === lang) : null;

  const displayWord   = hoveredIdx !== null ? words[hoveredIdx] : lastWord;
  const displaySymbol = findSymbol(symbols, displayWord);

  return (
    <div style={{ ...styles.panel, top, left }}>

      {/* Title Bar */}
      <div style={styles.titleBar}>
        <span style={styles.titleText}>Predictions</span>
        <span style={styles.modelBadge}>🤖 Backend NestJS</span>
        <span style={styles.langBadge}>
          {currentLang ? `${currentLang.flag} ${currentLang.label}` : '🌐 Auto'}
        </span>
        <button style={styles.closeBtn} onClick={() => setVisible(false)}>✕</button>
      </div>

      {/* Toolbar */}
      <div style={styles.toolbar}>
        {[
          { icon: '🖼️', label: 'Picture' },
          { icon: '📝', label: 'Correction', action: handleCorrection },
          { icon: '📢', label: 'Reading' },
          { icon: '⚙️', label: 'Configuration' },
        ].map((item, i) => {
          const isAudition = item.label === 'Reading';
          const isActive   = activeTab === item.label;
          const isPlaying  = isAudition && ttsLoading;

          return (
            <div
              key={i}
              style={{
                ...styles.toolBtn,
                background : isActive ? '#c8d8f0' : '#e8e8e8',
                borderColor: isActive ? '#7aa0d0' : '#ccc',
                opacity    : isAudition && ttsLoading && !isActive ? 0.5 : 1,
                cursor     : isAudition && ttsLoading ? 'not-allowed' : 'pointer',
              }}
              onClick={() => {
                setActiveTab(item.label);
                if (item.action) {
                  item.action();
                } else if (isAudition && onAudition && !ttsLoading) {
                  const wordToSpeak = hoveredIdx !== null ? words[hoveredIdx] : lastWord;
                  if (wordToSpeak) onAudition(wordToSpeak);
                }
              }}
            >
              <span style={styles.toolIcon}>
                {isPlaying ? '⏳' : (item.label === 'Correction' && isCorrecting ? '⏳' : item.icon)}
              </span>
              <span style={styles.toolLabel}>{item.label}</span>
            </div>
          );
        })}
      </div>

      <div style={styles.separator} />

      {/* Body : word list + symbol image */}
      <div style={styles.body}>
        <div style={styles.wordList}>
          {loading && [60, 45, 75, 50, 65, 40].map((w, i) => (
            <div key={i} style={styles.skeletonRow}>
              <div style={{ ...styles.skeletonBar, width: `${w}%` }} />
            </div>
          ))}

          {!loading && error && (
            <div style={styles.errorBox}>⚠️ {error}</div>
          )}

          {!loading && !error && words.map((word, i) => (
            <div
              key={i}
              style={{
                ...styles.wordRow,
                background: i === hoveredIdx ? '#c8d8f0' : 'white',
                fontWeight: i === hoveredIdx ? 600 : 400,
              }}
              onClick={() => onSelectWord(word)}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {word}
            </div>
          ))}
        </div>

        {/* Zone image */}
        <div style={styles.symbolBox}>
          <SymbolImage symbol={displaySymbol} label={displayWord} />
        </div>
      </div>

      {/* ✅ Zone de correction — Texte cliquable */}
      {showCorrection && correctedText && (
        <>
          <div style={styles.separator} />
          <div style={styles.correctionZone}>
            <div style={styles.correctionHeader}>
              <span style={styles.correctionIcon}>✏️</span>
              <span style={styles.correctionTitle}>Texte corrigé</span>
            </div>
            
            {/* Texte corrigé cliquable */}
            <div 
              style={styles.correctedTextBoxClickable}
              onClick={applyCorrection}
              title="Cliquer pour appliquer la correction dans l'éditeur"
            >
              {correctedText}
            </div>

          </div>
        </>
      )}

      {/* Zone chargement correction */}
      {isCorrecting && (
        <>
          <div style={styles.separator} />
          <div style={styles.correctionZone}>
            <div style={styles.correctionHeader}>
              <span style={styles.correctionIcon}>⏳</span>
              <span style={styles.correctionTitle}>Correction en cours...</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  panel: {
    position : 'absolute',
    width    : 440,
    background: '#f0f0f0',
    border   : '1px solid #aaa',
    borderRadius: 4,
    boxShadow: '3px 3px 12px rgba(0,0,0,0.2)',
    zIndex   : 9999,
    fontFamily: 'Tahoma, Arial, sans-serif',
    overflow : 'hidden',
  },
  titleBar: {
    background  : '#e8e8e8',
    borderBottom: '1px solid #ccc',
    padding     : '4px 10px',
    display     : 'flex',
    alignItems  : 'center',
    gap         : 6,
  },
  titleText  : { fontSize: 12, fontWeight: 600, color: '#333', flex: 1 },
  modelBadge : { fontSize: 10, background: '#ddd', padding: '1px 6px', borderRadius: 8, color: '#555' },
  langBadge  : { fontSize: 10, background: '#ddd', padding: '1px 6px', borderRadius: 8, color: '#555' },
  closeBtn   : { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#666', padding: '0 2px' },

  toolbar: {
    display     : 'flex',
    background  : '#f0f0f0',
    padding     : '6px 10px',
    gap         : 4,
    borderBottom: '1px solid #ccc',
  },
  toolBtn: {
    display       : 'flex',
    flexDirection : 'column',
    alignItems    : 'center',
    padding       : '4px 8px',
    cursor        : 'pointer',
    borderRadius  : 3,
    gap           : 2,
    background    : '#e8e8e8',
    border        : '1px solid #ccc',
    minWidth      : 55,
  },
  toolIcon : { fontSize: 20 },
  toolLabel: { fontSize: 10, color: '#444' },

  separator: { height: 1, background: '#ccc' },

  body: { display: 'flex', background: 'white', minHeight: 160 },
  wordList: { flex: 1, borderRight: '1px solid #ddd' },
  wordRow: {
    padding       : '7px 14px',
    fontSize      : 14,
    cursor        : 'pointer',
    color         : '#111',
    borderBottom  : '1px solid #f0f0f0',
    transition    : 'background 0.1s',
    userSelect    : 'none',
  },
  symbolBox: {
    width          : 130,
    display        : 'flex',
    alignItems     : 'center',
    justifyContent : 'center',
    background     : 'white',
    padding        : 8,
  },
  symbolInner: {
    display       : 'flex',
    flexDirection : 'column',
    alignItems    : 'center',
    gap           : 4,
  },
  symbolImg: {
    width        : 95,
    height       : 95,
    objectFit    : 'contain',
    border       : '1px solid #eee',
    borderRadius : 6,
    padding      : 4,
  },
  symbolLabel: {
    fontSize      : 11,
    color         : '#555',
    textAlign     : 'center',
    textTransform : 'capitalize',
    maxWidth      : 110,
    overflow      : 'hidden',
    textOverflow  : 'ellipsis',
    whiteSpace    : 'nowrap',
  },
  noSymbol   : { fontSize: 36, color: '#ddd' },
  skeletonRow: { padding: '11px 14px', borderBottom: '1px solid #f0f0f0' },
  skeletonBar: {
    height         : 12,
    background     : 'linear-gradient(90deg, #e0e0e0 25%, #f0f0f0 50%, #e0e0e0 75%)',
    backgroundSize : '200% 100%',
    borderRadius   : 3,
  },
  errorBox: { padding: '12px 14px', color: '#c0392b', fontSize: 12, lineHeight: 1.7 },

  // Zone de correction
  correctionZone: {
    background : '#fff3e0',
    borderTop  : '2px solid #e67e22',
    padding    : '12px 14px',
  },
  correctionHeader: {
    display    : 'flex',
    alignItems : 'center',
    gap        : 6,
    marginBottom: 10,
  },
  correctionIcon : { fontSize: 16 },
  correctionTitle: { fontSize: 13, fontWeight: 700, color: '#b45309' },

  // Texte corrigé cliquable
  correctedTextBoxClickable: {
    background   : 'white',
    border       : '2px solid #f59e0b',
    borderRadius : 6,
    padding      : '10px 12px',
    fontSize     : 14,
    color        : '#1a1a1a',
    lineHeight   : 1.6,
    whiteSpace   : 'pre-wrap',
    cursor       : 'pointer',
    transition   : 'all 0.2s',
    minHeight    : 44,
  },

  instructionText: {
    fontSize   : 11,
    color      : '#666',
    marginTop  : 6,
    fontStyle  : 'italic',
    textAlign  : 'center',
  },
};