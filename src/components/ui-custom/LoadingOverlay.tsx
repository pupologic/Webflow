import React, { useEffect, useState } from 'react';

interface LoadingOverlayProps {
  progress: number;
  show: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ progress, show }) => {
  const [shouldRender, setShouldRender] = useState(show);

  useEffect(() => {
    if (show) {
      setShouldRender(true);
    } else {
      const timer = setTimeout(() => setShouldRender(false), 500); // Fade out duration
      return () => clearTimeout(timer);
    }
  }, [show]);

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#09090b] transition-opacity duration-500 ${show ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="w-full max-w-lg px-8 flex flex-col items-center">
        {/* Progress bar container - Tall bar */}
        <div className="w-full h-8 bg-zinc-800/50 rounded-lg overflow-hidden border border-white/5 relative">
          <div 
            className="h-full bg-blue-600 transition-all duration-300 ease-out shadow-[0_0_20px_rgba(37,99,235,0.3)]"
            style={{ width: `${progress}%` }}
          />
          
          {/* Percentage inside bar */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold text-white drop-shadow-md">
              {Math.round(progress)}%
            </span>
          </div>
        </div>
      </div>
      
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden opacity-10">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px]" />
      </div>
    </div>
  );
};
