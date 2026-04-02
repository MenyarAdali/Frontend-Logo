import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import WordPredictor, { LANGUAGES } from './components/WordPredictor';
import './App.css';

const DEFAULT_AUDIO = { speed: 1.0, pitch: 1.0, volume: 1.0 };

export default function App() {
  const [value, setValue]               = useState('');
  const [plainText, setPlainText]       = useState('');
  const [lastWord, setLastWord]         = useState('');
  const [cursorBounds, setCursorBounds] = useState({ top: 0, left: 0, bottom: 0 });
  const [selectedLang, setSelectedLang] = useState(null);
  const [ttsLoading, setTtsLoading]     = useState(false);
  const [ttsError, setTtsError]         = useState('');
  const [audio, setAudio]               = useState(DEFAULT_AUDIO);
  const [isPanelOpen, setIsPanelOpen]   = useState(false);

  const audioRef = useRef(null);
  const quillRef = useRef(null);

  const [autoRead, setAutoRead] = useState(true);

  // ─────────────────────────────────────────────
  // ✅ 1. speakWord
  // ─────────────────────────────────────────────
  const speakWord = useCallback(async (wordText) => {
    if (!wordText || !wordText.trim()) return;

    setTtsError('');
    setTtsLoading(true);

    try {
      const response = await fetch('http://localhost:3001/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text  : wordText.trim(),
          lang  : selectedLang ?? 'en',
          speed : audio.speed,
          pitch : audio.pitch,
          volume: audio.volume,
        }),
      });

      if (!response.ok) throw new Error(`Server error ${response.status}`);

      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }

      const player  = new Audio(url);
      player.volume = Math.min(1.0, audio.volume);
      audioRef.current = player;
      await player.play();

    } catch (err) {
      console.error('speakWord error:', err);
      setTtsError('❌ Lecture échouée');
    } finally {
      setTtsLoading(false);
    }
  }, [selectedLang, audio]);

  // ─────────────────────────────────────────────
  // ✅ 2. handleChange
  // ─────────────────────────────────────────────
  const handleChange = useCallback((content, delta, source, editor) => {
    setValue(content);
    const text = editor.getText().trim();
    setPlainText(text);
    const words = text.split(/\s+/).filter(Boolean);
    const last  = words[words.length - 1] || '';
    setLastWord(last);

    if (source !== 'user') return;
    const selection = editor.getSelection();
    if (!selection) return;
    try {
      const bounds = editor.getBounds(selection.index);
      setCursorBounds(bounds);
    } catch (e) {}

    const spaceInserted = delta.ops?.some(op => op.insert === ' ');
    if (spaceInserted && autoRead) {
      const allWords  = text.split(/\s+/).filter(Boolean);
      const spokenWord = allWords[allWords.length - 1];
      if (spokenWord) speakWord(spokenWord);
    }
  }, [speakWord, autoRead]);

  // ─────────────────────────────────────────────
  // ✅ 3. handleSelectWord
  // ─────────────────────────────────────────────
  const handleSelectWord = useCallback((word) => {
    const editor    = quillRef.current.getEditor();
    const selection = editor.getSelection();
    const index     = selection ? selection.index : editor.getLength();
    const text      = editor.getText();
    const prefix    = (text[index - 1] && text[index - 1] !== ' ') ? ' ' : '';
    editor.insertText(index, prefix + word + ' ');
    editor.setSelection(index + prefix.length + word.length + 1);
  }, []);

  // ─────────────────────────────────────────────
  // ✅ NOUVELLE FONCTION : handleReplaceText (pour la correction)
  // ─────────────────────────────────────────────
  const handleReplaceText = useCallback((newText) => {
    const editor = quillRef.current?.getEditor();
    if (!editor || !newText) return;

    editor.setText(newText.trim());           // Remplace tout le texte
    setValue(newText.trim());
    setPlainText(newText.trim());

    const words = newText.trim().split(/\s+/).filter(Boolean);
    setLastWord(words[words.length - 1] || '');

    // Remet le curseur à la fin
    const length = editor.getLength();
    editor.setSelection(length, 0);
  }, []);

  // ─────────────────────────────────────────────
  // ✅ 4. Mouse selection → speak
  // ─────────────────────────────────────────────
  useEffect(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;

    const handleMouseUp = () => {
      const range = editor.getSelection();
      if (range && range.length > 1) {
        const selected = editor.getText(range.index, range.length).trim();
        if (selected) speakWord(selected);
      }
    };

    editor.root.addEventListener('mouseup', handleMouseUp);
    return () => editor.root.removeEventListener('mouseup', handleMouseUp);
  }, [speakWord]);

  // ─────────────────────────────────────────────
  // ✅ 5. speakText
  // ─────────────────────────────────────────────
  const speakText = async () => {
    const editor    = quillRef.current.getEditor();
    const selection = editor.getSelection();

    if (!selection || selection.length === 0) {
      setTtsError('⚠️ Sélectionnez du texte d\'abord');
      return;
    }

    const selectedText = editor.getText(selection.index, selection.length).trim();
    if (!selectedText) { 
      setTtsError('⚠️ La sélection est vide'); 
      return; 
    }

    speakWord(selectedText);
  };

  // ─────────────────────────────────────────────
  // ✅ 6. Stop audio
  // ─────────────────────────────────────────────
  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className="app-container">

      {/* Header */}
      <div style={styles.headerBar}>
        <h1 style={styles.title}>🗣️ Aide à la Communication</h1>
        <div style={styles.langSelector}>
          <button
            style={{ ...styles.langBtn, background: selectedLang === null ? '#1e40af' : '#e5e7eb', color: selectedLang === null ? 'white' : '#374151' }}
            onClick={() => setSelectedLang(null)}
          >
            🌐 Auto
          </button>
          {LANGUAGES.map(l => (
            <button key={l.code}
              style={{ ...styles.langBtn, background: selectedLang === l.code ? '#1e40af' : '#e5e7eb', color: selectedLang === l.code ? 'white' : '#374151' }}
              onClick={() => setSelectedLang(l.code)}
            >
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      </div>

      <p className="hint">Tapez un mot → le modèle prédit les mots suivants en temps réel</p>

      {/* Editor */}
      <div style={{ position: 'relative' }}>
        <ReactQuill
          ref={quillRef}
          value={value}
          onChange={handleChange}
          theme="snow"
          placeholder="Commencez à écrire..."
        />
        <WordPredictor
          fullText={plainText}
          lastWord={lastWord}
          cursorBounds={cursorBounds}
          lang={selectedLang}
          onSelectWord={handleSelectWord}
          onAudition={speakWord}
          ttsLoading={ttsLoading}
          onReplaceText={handleReplaceText}     
        />
      </div>

      {/* TTS Error */}
      {ttsError && <p style={{ color: 'red', marginTop: 8 }}>{ttsError}</p>}

      {/* TTS Controls */}
      <div style={styles.ttsBar}>
        <button onClick={speakText} disabled={ttsLoading} style={{
          ...styles.ttsBtn,
          background: ttsLoading ? '#9ca3af' : '#1e40af',
          cursor: ttsLoading ? 'not-allowed' : 'pointer',
        }}>
          {ttsLoading ? '⏳ Lecture...' : '🔊 Lire la sélection'}
        </button>

        <button onClick={stopAudio} style={{ ...styles.ttsBtn, background: '#dc2626' }}>
          ⏹ Stop
        </button>
        <button
          onClick={() => setAutoRead(p => !p)}
          style={{
            ...styles.ttsBtn,
            background  : autoRead ? '#16a34a' : '#6b7280',
            display     : 'flex',
            alignItems  : 'center',
            gap         : 6,
          }}
          title={autoRead ? 'Lecture auto activée — cliquer pour désactiver' : 'Lecture auto désactivée — cliquer pour activer'}
        >
          {autoRead ? '🔊 Auto : ON' : '🔇 Auto : OFF'}
        </button>

        <button
          onClick={() => setIsPanelOpen(p => !p)}
          style={{ ...styles.ttsBtn, background: isPanelOpen ? '#374151' : '#6b7280' }}
        >
          🎛️ {isPanelOpen ? 'Fermer' : 'Paramètres voix'}
        </button>
      </div>

      {/* Sound Editor Panel */}
      {isPanelOpen && (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>🎛️ Paramètres de la voix</h3>

          <div style={styles.sliderRow}>
            <label style={styles.sliderLabel}>
              🏃 Vitesse
              <span style={styles.sliderValue}>{audio.speed.toFixed(1)}×</span>
            </label>
            <input type="range" min="0.5" max="2.0" step="0.1"
              value={audio.speed}
              onChange={e => setAudio(a => ({ ...a, speed: parseFloat(e.target.value) }))}
              style={styles.slider}
            />
            <div style={styles.sliderHints}>
              <span>Lent</span><span>Normal</span><span>Rapide</span>
            </div>
          </div>

          <div style={styles.sliderRow}>
            <label style={styles.sliderLabel}>
              🎵 Tonalité
              <span style={styles.sliderValue}>{audio.pitch.toFixed(1)}</span>
            </label>
            <input type="range" min="0.5" max="2.0" step="0.1"
              value={audio.pitch}
              onChange={e => setAudio(a => ({ ...a, pitch: parseFloat(e.target.value) }))}
              style={styles.slider}
            />
            <div style={styles.sliderHints}>
              <span>Grave</span><span>Normal</span><span>Aigu</span>
            </div>
          </div>

          <div style={styles.sliderRow}>
            <label style={styles.sliderLabel}>
              🔈 Volume
              <span style={styles.sliderValue}>{Math.round(audio.volume * 100)}%</span>
            </label>
            <input type="range" min="0.1" max="1.0" step="0.05"
              value={audio.volume}
              onChange={e => setAudio(a => ({ ...a, volume: parseFloat(e.target.value) }))}
              style={styles.slider}
            />
            <div style={styles.sliderHints}>
              <span>Faible</span><span>Moyen</span><span>Max</span>
            </div>
          </div>

          <button
            onClick={() => setAudio(DEFAULT_AUDIO)}
            style={{ ...styles.ttsBtn, background: '#6b7280', marginTop: 8 }}
          >
            ↺ Réinitialiser
          </button>
        </div>
      )}

      <p style={{ marginTop: 12, color: '#888', fontSize: 13 }}>
        💡 Espace = lit le mot · Sélection = lit la phrase · Clic Reading = lit la prédiction
      </p>
    </div>
  );
}

const styles = {
  headerBar   : { display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12, marginBottom:8 },
  title       : { fontSize:22, fontWeight:700, color:'#1a1a2e', margin:0 },
  langSelector: { display:'flex', gap:6, flexWrap:'wrap' },
  langBtn     : { padding:'5px 11px', border:'none', borderRadius:20, fontSize:13, cursor:'pointer', fontWeight:500, transition:'all 0.15s' },
  ttsBar      : { display:'flex', gap:10, marginTop:20, flexWrap:'wrap', alignItems:'center' },
  ttsBtn      : { padding:'9px 18px', border:'none', borderRadius:8, color:'white', fontSize:14, cursor:'pointer', fontWeight:600, transition:'background 0.2s' },
  panel       : { marginTop:16, padding:20, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12 },
  panelTitle  : { margin:'0 0 16px', fontSize:16, fontWeight:700, color:'#1e293b' },
  sliderRow   : { marginBottom:18 },
  sliderLabel : { display:'flex', justifyContent:'space-between', fontSize:14, fontWeight:600, color:'#374151', marginBottom:6 },
  sliderValue : { color:'#1e40af', fontWeight:700 },
  slider      : { width:'100%', accentColor:'#1e40af', cursor:'pointer' },
  sliderHints : { display:'flex', justifyContent:'space-between', fontSize:11, color:'#9ca3af', marginTop:3 },
};