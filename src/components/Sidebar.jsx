import React, { useState, useEffect, useRef } from "react";

export default function Sidebar({
  stops,
  onAddStop,
  onRemoveStop,
  onReorderStops,
  onUpdateStop,
  pathMode,
  onChangePathMode,
  animOptions,
  onChangeOptions,
  onPreview,
  onMakeAnimation,
  isGenerating,
  progressText,
  progressPct,
  theme,
  onChangeTheme
}) {
  const [activeTab, setActiveTab] = useState("route"); // "route" or "settings"
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  // Trigger search on query change (with debounce)
  useEffect(() => {
    if (searchQuery.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(searchQuery);
    }, 500);

    return () => clearTimeout(searchTimeoutRef.current);
  }, [searchQuery, pathMode]);

  const executeSearch = async (query) => {
    try {
      // If Rail Mode: append "railway station" to geocoding search
      const finalQuery = pathMode === "rail" ? `${query} railway station` : query;
      const url = `https://nominatim.openstreetmap.org/search?format=json&namedetails=1&addressdetails=1&limit=10&q=${encodeURIComponent(finalQuery)}`;
      
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Search failed");
      const data = await resp.json();

      let filtered = data;
      if (pathMode === "rail") {
        // Strict filtering to ensure we only get railway-related stations
        filtered = data.filter(item => {
          const type = item.type || "";
          const cls = item.class || "";
          const name = item.display_name.toLowerCase();
          
          return (
            cls === "railway" ||
            type === "station" ||
            type === "halt" ||
            type === "junction" ||
            type === "stop" ||
            name.includes("station") ||
            name.includes("junction") ||
            name.includes(" jn") ||
            name.includes(" halt") ||
            name.includes(" terminus")
          );
        });
      }

      setSearchResults(filtered);
    } catch (err) {
      console.error("Geocoding failed", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectResult = (item) => {
    // Extract Hindi translation if available from OSM namedetails
    const hindiName = item.namedetails && item.namedetails["name:hi"] 
      ? item.namedetails["name:hi"] 
      : "";

    // Clean up display name (e.g. "Patna Junction, Station Road, Patna...")
    const fullName = item.display_name;
    const cleanName = fullName.split(",")[0] || searchQuery;

    onAddStop({
      name: cleanName,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      hindi: hindiName
    });

    setSearchQuery("");
    setSearchResults([]);
  };

  return (
    <div className="macos-sidebar">
      {/* App Header */}
      <div className="sidebar-header">
        <h1>
          {/* macOS Map Icon SVG */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-color)" }}>
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
            <line x1="9" y1="3" x2="9" y2="18" />
            <line x1="15" y1="6" x2="15" y2="21" />
          </svg>
          Map Animator
        </h1>
        <div className="subtitle">High-Fidelity Infographics</div>
      </div>

      {/* Sidebar Tabs */}
      <div className="sidebar-tabs">
        <button className={`tab-btn ${activeTab === "route" ? "active" : ""}`} onClick={() => setActiveTab("route")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
          Route Builder
        </button>
        <button className={`tab-btn ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          Settings
        </button>
      </div>

      <div className="sidebar-scroll">
        {activeTab === "route" ? (
          <>
            {/* TAB: ROUTE BUILDER */}
            {/* SECTION 1: SEARCH STOPS */}
            <div className="input-group">
              <div className="section-title">Add Stops</div>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  className="macos-input"
                  placeholder={pathMode === "rail" ? "Search railway stations..." : "Search places, cities, roads..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                
                {/* Search loading indicator */}
                {isSearching && (
                  <div style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", fontSize: "11px", color: "var(--text-secondary)" }}>
                    Searching...
                  </div>
                )}

                {/* Results popup */}
                {searchResults.length > 0 && (
                  <div className="search-results">
                    {searchResults.map((item) => {
                      const firstPart = item.display_name.split(",")[0];
                      const remaining = item.display_name.split(",").slice(1).join(",").trim();
                      return (
                        <div key={item.place_id} className="search-item" onClick={() => handleSelectResult(item)}>
                          <span className="name">{firstPart}</span>
                          <span className="details">{remaining}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {searchQuery.trim().length >= 3 && !isSearching && searchResults.length === 0 && (
                  <div className="search-results">
                    <div className="no-results">No places found</div>
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 1.5: EXPORT FILENAME */}
            <div className="input-group" style={{ marginBottom: "12px" }}>
              <span className="input-label" style={{ fontSize: "11px", marginBottom: "4px" }}>Custom File Name</span>
              <input
                type="text"
                className="macos-input"
                placeholder="Auto-generated name (e.g. Start_to_End)"
                value={animOptions.exportName || ""}
                onChange={(e) => onChangeOptions("exportName", e.target.value)}
                style={{ fontSize: "12px", height: "26px", padding: "4px 8px" }}
              />
            </div>

            {/* SECTION 2: STOPS LIST */}
            <div>
              <div className="section-title">Route Stops ({stops.length})</div>
              {stops.length === 0 ? (
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", textAlign: "center", padding: "20px 0", border: "1px dashed var(--border-color)", borderRadius: "var(--radius-sm)" }}>
                  No stops added yet.<br />Search above or click on the map!
                </div>
              ) : (
                <div className="stops-list">
                  {stops.map((stop, idx) => (
                    <div key={stop.id} className="stop-card">
                      <div className="stop-number">{idx + 1}</div>
                      <div className="stop-info">
                        <div className="stop-title-row">
                          <div className="stop-name">{stop.name}</div>
                          {/* Controls to Move Up / Down */}
                          <div className="stop-actions">
                            <button className="icon-btn" disabled={idx === 0} onClick={() => onReorderStops(idx, idx - 1)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                            </button>
                            <button className="icon-btn" disabled={idx === stops.length - 1} onClick={() => onReorderStops(idx, idx + 1)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                            </button>
                            <button className="icon-btn delete" onClick={() => onRemoveStop(stop.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            </button>
                          </div>
                        </div>
                        {/* Custom Text fields for English & Hindi labels */}
                        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                          <input
                            type="text"
                            className="stop-input"
                            placeholder="Label Name"
                            value={stop.customName || ""}
                            onChange={(e) => onUpdateStop(stop.id, "customName", e.target.value)}
                          />
                          <input
                            type="text"
                            className="stop-input"
                            placeholder="Hindi (optional)"
                            value={stop.hindi || ""}
                            onChange={(e) => onUpdateStop(stop.id, "hindi", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* TAB: GLOBAL SETTINGS */}
            {/* SECTION 3: THEME PREFERENCE */}
            <div className="input-group">
              <span className="input-label">App Appearance</span>
              <div className="macos-segmented">
                <button className={`segmented-btn ${theme === "light" ? "active" : ""}`} onClick={() => onChangeTheme("light")}>
                  Light
                </button>
                <button className={`segmented-btn ${theme === "dark" ? "active" : ""}`} onClick={() => onChangeTheme("dark")}>
                  Dark Mode
                </button>
              </div>
            </div>

            {/* SECTION 4: PATH MODE */}
            <div className="input-group">
              <span className="input-label">Path Connection Mode</span>
              <div className="macos-segmented">
                <button className={`segmented-btn ${pathMode === "rail" ? "active" : ""}`} onClick={() => onChangePathMode("rail")}>
                  Railroad Tracks
                </button>
                <button className={`segmented-btn ${pathMode === "highway" ? "active" : ""}`} onClick={() => onChangePathMode("highway")}>
                  Roads & Highways
                </button>
              </div>
            </div>

            {/* SECTION 5: DISPLAY LANGUAGE */}
            <div className="input-group">
              <span className="input-label">Display Language</span>
              <div className="macos-segmented">
                <button className={`segmented-btn ${animOptions.language === "english" ? "active" : ""}`} onClick={() => onChangeOptions("language", "english")}>
                  English
                </button>
                <button className={`segmented-btn ${animOptions.language === "hindi" ? "active" : ""}`} onClick={() => onChangeOptions("language", "hindi")}>
                  Hindi
                </button>
              </div>
            </div>

            {/* SECTION 6: DURATION SLIDER */}
            <div className="input-group">
              <span className="input-label">Animation Duration</span>
              <div className="macos-slider-container">
                <input
                  type="range"
                  className="macos-slider"
                  min="5"
                  max="45"
                  step="1"
                  value={animOptions.duration}
                  disabled={animOptions.autoDuration}
                  onChange={(e) => onChangeOptions("duration", parseInt(e.target.value))}
                />
                <span className="slider-val" style={{ opacity: animOptions.autoDuration ? 0.6 : 1 }}>
                  {animOptions.duration}s {animOptions.autoDuration && "(Auto)"}
                </span>
              </div>
            </div>

            {/* SECTION 7: TIMING & FORMATTING OPTIONS */}
            <div className="input-group">
              <span className="input-label">Timing & Formatting Options</span>
              <div className="settings-grid" style={{ marginTop: "4px" }}>
                <div className="checkbox-row" onClick={() => onChangeOptions("autoDuration", !animOptions.autoDuration)}>
                  <input
                    type="checkbox"
                    className="macos-checkbox"
                    checked={animOptions.autoDuration}
                    readOnly
                  />
                  <span style={{ fontSize: "12.5px" }}>Auto Duration</span>
                </div>

                <div className="checkbox-row" onClick={() => onChangeOptions("showLabels", !animOptions.showLabels)}>
                  <input
                    type="checkbox"
                    className="macos-checkbox"
                    checked={animOptions.showLabels}
                    readOnly
                  />
                  <span style={{ fontSize: "12.5px" }}>Show Labels</span>
                </div>

                <div className="checkbox-row" onClick={() => onChangeOptions("showVehicle", !animOptions.showVehicle)}>
                  <input
                    type="checkbox"
                    className="macos-checkbox"
                    checked={animOptions.showVehicle !== false}
                    readOnly
                  />
                  <span style={{ fontSize: "12.5px" }}>Show Vehicle</span>
                </div>

                <div className="checkbox-row" onClick={() => onChangeOptions("fps", animOptions.fps === 60 ? 30 : 60)}>
                  <input
                    type="checkbox"
                    className="macos-checkbox"
                    checked={animOptions.fps === 60}
                    readOnly
                  />
                  <span style={{ fontSize: "12.5px" }}>60 FPS (Fluid)</span>
                </div>
              </div>
            </div>

            {/* SECTION 8: EXPORT SETTINGS */}
            <div className="input-group" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "12px", marginTop: "12px" }}>
              <div className="section-title" style={{ paddingLeft: 0, marginBottom: "8px" }}>Export Options</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div>
                  <span className="input-label" style={{ fontSize: "11px", marginBottom: "4px" }}>Export Destination</span>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <div style={{ 
                      flex: 1, 
                      fontSize: "11px", 
                      color: "var(--text-secondary)", 
                      backgroundColor: "var(--bg-card)", 
                      border: "1px solid var(--border-color)", 
                      borderRadius: "6px", 
                      padding: "4px 8px", 
                      whiteSpace: "nowrap", 
                      overflow: "hidden", 
                      textOverflow: "ellipsis",
                      height: "26px",
                      lineHeight: "16px"
                    }} title={animOptions.exportDirectory || "Native macOS Save sheet fallback"}>
                      {animOptions.exportDirectory ? animOptions.exportDirectory.split("/").slice(-2).join("/") : "Save Dialogue Prompt"}
                    </div>
                    <button 
                      className="macos-btn secondary" 
                      style={{ fontSize: "11px", height: "26px", padding: "0 10px", width: "auto", borderRadius: "6px" }}
                      onClick={async () => {
                        const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
                        if (isTauri) {
                          try {
                            const { open } = await import("@tauri-apps/plugin-dialog");
                            const selected = await open({
                              directory: true,
                              multiple: false,
                              title: "Select Export Folder"
                            });
                            if (selected) {
                              onChangeOptions("exportDirectory", selected);
                            }
                          } catch (err) {
                            console.error("Folder picker failed: ", err);
                          }
                        } else {
                          alert("Folder picker is only available in standalone desktop mode.");
                        }
                      }}
                    >
                      Change...
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* FOOTER ACTIONS AREA */}
      <div className="sidebar-footer">
        {/* Real-time Loading progress panel */}
        {isGenerating && (
          <div className="progress-panel">
            <div className="progress-header">
              <span className="progress-text">{progressText}</span>
              <span className="progress-pct">{progressPct}%</span>
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${progressPct}%` }}></div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px" }}>
          <button className="macos-btn secondary" style={{ flex: 1 }} disabled={stops.length < 2 || isGenerating} onClick={onPreview}>
            Preview Run
          </button>
          
          <button className="macos-btn primary" style={{ flex: 1.2 }} disabled={stops.length < 2 || isGenerating} onClick={onMakeAnimation}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Make Animation
          </button>
        </div>
      </div>
    </div>
  );
}
