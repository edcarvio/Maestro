import React, { useEffect, useRef } from 'react';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';

interface LightboxModalProps {
  image: string;
  stagedImages: string[];
  onClose: () => void;
  onNavigate: (image: string) => void;
}

export function LightboxModal({ image, stagedImages, onClose, onNavigate }: LightboxModalProps) {
  const lightboxRef = useRef<HTMLDivElement>(null);
  const currentIndex = stagedImages.indexOf(image);
  const canNavigate = stagedImages.length > 1;
  const layerIdRef = useRef<string>();
  const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();

  // Register layer on mount
  useEffect(() => {
    const layerId = registerLayer({
      type: 'overlay',
      priority: MODAL_PRIORITIES.LIGHTBOX,
      blocksLowerLayers: true,
      capturesFocus: true,
      focusTrap: 'none',
      ariaLabel: 'Image Lightbox',
      onEscape: onClose,
      allowClickOutside: true
    });
    layerIdRef.current = layerId;

    return () => {
      if (layerIdRef.current) {
        unregisterLayer(layerIdRef.current);
      }
    };
  }, [registerLayer, unregisterLayer]);

  // Update handler when onClose changes
  useEffect(() => {
    if (layerIdRef.current) {
      updateLayerHandler(layerIdRef.current, onClose);
    }
  }, [onClose, updateLayerHandler]);

  useEffect(() => {
    // Focus the lightbox when it opens
    lightboxRef.current?.focus();
  }, []);

  const goToPrev = () => {
    if (canNavigate && currentIndex > 0) {
      onNavigate(stagedImages[currentIndex - 1]);
    }
  };

  const goToNext = () => {
    if (canNavigate && currentIndex < stagedImages.length - 1) {
      onNavigate(stagedImages[currentIndex + 1]);
    }
  };

  return (
    <div
      ref={lightboxRef}
      className="absolute inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrev(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); goToNext(); }
      }}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Image Lightbox"
    >
      {canNavigate && currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); goToPrev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 backdrop-blur-sm transition-colors"
        >
          ←
        </button>
      )}
      <img src={image} className="max-w-[90%] max-h-[90%] rounded shadow-2xl" onClick={(e) => e.stopPropagation()} />
      {canNavigate && currentIndex < stagedImages.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goToNext(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 backdrop-blur-sm transition-colors"
        >
          →
        </button>
      )}
      <div className="absolute bottom-10 text-white text-sm opacity-70">
        {canNavigate ? `Image ${currentIndex + 1} of ${stagedImages.length} • ← → to navigate • ` : ''}ESC to close
      </div>
    </div>
  );
}
