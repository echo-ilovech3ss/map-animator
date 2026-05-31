import React, { useEffect, useRef } from "react";
import L from "leaflet";

export default function MapContainer({ stops, onAddStop, theme, routePath, mapStyle }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersGroupRef = useRef([]);
  const polylineRef = useRef(null);
  const tileLayerRef = useRef(null);
  const refTileLayerRef = useRef(null);

  // Initialize Map
  useEffect(() => {
    if (mapInstanceRef.current) return; // Prevent double initialization

    // Set default coordinates (Center of India)
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false
    }).setView([20.5937, 78.9629], 5);

    mapInstanceRef.current = map;

    // Custom Zoom controls at bottom right
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Map Click Listener to add location
    map.on("click", async (e) => {
      const { lat, lng } = e.latlng;
      
      // Request Reverse Geocoding to get a pretty name
      try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`);
        const data = await resp.json();
        
        // Clean display name by using the most specific component (first split)
        const fullName = data.display_name || "";
        const cleanName = fullName.split(",")[0] || `Point (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
        
        onAddStop({ name: cleanName, lat, lon: lng });
      } catch (err) {
        console.error("Reverse geocoding failed: ", err);
        onAddStop({ name: `Stop (${lat.toFixed(3)}, ${lng.toFixed(3)})`, lat, lon: lng });
      }
    });

    // Invalidate map size once container layout has fully settled on screen
    const resizeTimer1 = setTimeout(() => map.invalidateSize(), 100);
    const resizeTimer2 = setTimeout(() => map.invalidateSize(), 500);

    // Window resize event handler to keep map dimensions correct
    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(resizeTimer1);
      clearTimeout(resizeTimer2);
      window.removeEventListener("resize", handleResize);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Toggle Map Style and Light/Dark Map tiles dynamically
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove previous base and reference layers
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    if (refTileLayerRef.current) {
      map.removeLayer(refTileLayerRef.current);
      refTileLayerRef.current = null;
    }

    if (mapStyle === "satellite") {
      // 1. Add Satellite base layer
      const satUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      tileLayerRef.current = L.tileLayer(satUrl, {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
      }).addTo(map);
    } else {
      // 1. Add Political base layer (nolabels to avoid clashes)
      const tileUrl = theme === "dark"
        ? "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
        : "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";

      tileLayerRef.current = L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors &copy; <a href=\"https://carto.com/attributions\">CARTO</a>"
      }).addTo(map);
    }

    // 2. ALWAYS add Boundaries and Places reference overlay for dense labels
    let refUrl;
    if (mapStyle === "satellite") {
      refUrl = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
    } else {
      refUrl = theme === "dark"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
    }

    refTileLayerRef.current = L.tileLayer(refUrl, {
      maxZoom: 19
    }).addTo(map);
  }, [theme, mapStyle]);

  // Update Markers & Polyline when Stops change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // 1. Remove previous markers
    markersGroupRef.current.forEach(m => map.removeLayer(m));
    markersGroupRef.current = [];

    // 2. Remove previous polyline
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    if (stops.length === 0) return;

    // 3. Draw new markers with Apple Map visual styling
    const latLns = [];
    stops.forEach((stop, idx) => {
      const latlng = [stop.lat, stop.lon];
      latLns.push(latlng);

      const isFirst = idx === 0;
      const isLast = idx === stops.length - 1;
      
      let markerClass = "stop-marker-dot";
      if (isFirst) markerClass += " first";
      else if (isLast) markerClass += " last";

      const htmlIcon = L.divIcon({
        className: "route-stop-marker",
        html: `<div class="${markerClass}">${idx + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const name = stop.customName || stop.name;
      const marker = L.marker(latlng, { icon: htmlIcon })
        .addTo(map)
        .bindTooltip(name, {
          permanent: true,
          direction: "top",
          offset: [0, -10],
          opacity: 0.9,
          className: "macos-map-tooltip"
        });

      markersGroupRef.current.push(marker);
    });

    // 4. Draw snapped physical path or fallback to straight connector
    if (routePath && routePath.length > 0) {
      polylineRef.current = L.polyline(routePath, {
        color: "#e06020",
        weight: 4.5,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(map);
    } else if (stops.length >= 2) {
      // Temporary dashed straight line while background OSM router is loading
      polylineRef.current = L.polyline(latLns, {
        color: "#e06020",
        dashArray: "8, 8",
        weight: 2.5,
        opacity: 0.5,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(map);
    }

    // 5. Auto-fit bounding box of all pins or route path
    const boundsCoords = (routePath && routePath.length > 0) ? routePath : latLns;
    if (boundsCoords.length > 0) {
      map.fitBounds(L.latLngBounds(boundsCoords), {
        padding: [75, 75],
        maxZoom: 12
      });
    }
  }, [stops, routePath]);

  return (
    <div className="macos-content">
      {/* Styles Injection for Map tooltips */}
      <style>{`
        .macos-map-tooltip {
          background-color: rgba(255, 255, 255, 0.96) !important;
          border: 1px solid rgba(0, 0, 0, 0.12) !important;
          border-radius: 8px !important;
          padding: 4px 10px !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          color: #1d1d1f !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.06) !important;
        }
        .macos-map-tooltip::before {
          border-top-color: rgba(255, 255, 255, 0.96) !important;
        }
        
        .dark-theme .macos-map-tooltip {
          background-color: rgba(30, 30, 32, 0.96) !important;
          border: 1px solid rgba(255, 255, 255, 0.15) !important;
          color: #f5f5f7 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2) !important;
        }
        .dark-theme .macos-map-tooltip::before {
          border-top-color: rgba(30, 30, 32, 0.96) !important;
        }
      `}</style>
      
      <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
