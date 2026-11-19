'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { playKitchenBell } from '@/lib/sound';
import { Delete, UtensilsCrossed } from 'lucide-react';

export default function LoginPinPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Asegura que al llegar al login no quede ninguna sesión previa atorada
  useEffect(() => {
    sessionStorage.removeItem('usuario_activo');
    setLoading(false);
    setPin('');
  }, []);

  const handleDigit = async (digit: string) => {
    if (pin.length >= 4 || loading) return;
    const nextPin = pin + digit;
    setPin(nextPin);
    setError('');

    if (nextPin.length === 4) {
      setLoading(true);

      // El sonido nunca debe bloquear el acceso si Safari restringe el audio
      try {
        playKitchenBell();
      } catch {
        // Ignorar si el navegador bloquea el audio
      }

      try {
        const { data, error: dbError } = await supabase
          .from('usuarios')
          .select('*')
          .eq('pin_acceso', nextPin)
          .eq('activo', true)
          .single();

        if (dbError || !data) {
          if (dbError?.code === 'PGRST116') {
            setError('PIN incorrecto');
          } else {
            setError(`Error BD: ${dbError?.message || 'Sin conexión'}`);
          }
          setPin('');
          setLoading(false);
          return;
        }

        sessionStorage.setItem('usuario_activo', JSON.stringify(data));

        if (data.rol === 'mesero') router.push('/mesero');
        else if (data.rol === 'cocina' || data.rol === 'barra') router.push('/cocina');
        else router.push('/admin');
      } catch {
        setError('Error de red. Intenta de nuevo.');
        setPin('');
        setLoading(false);
      }
    }
  };

  return (
    <main className="min-h-dvh bg-slate-950 text-white flex flex-col items-center justify-center p-6 select-none">
      <div className="w-full max-w-xs flex flex-col items-center">
        <div className="bg-gradient-to-tr from-cyan-500/20 to-teal-400/10 p-4 rounded-3xl ring-1 ring-cyan-400/20 mb-4 shadow-lg shadow-cyan-950/40">
          <UtensilsCrossed className="w-9 h-9 text-cyan-400" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Comanda Pro</h1>
        <p className="text-slate-400 text-sm mb-7">Ingresa tu PIN de acceso</p>

        {/* Indicadores de PIN */}
        <div className="flex gap-4 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                pin.length > i
                  ? 'bg-cyan-400 scale-125 shadow-[0_0_12px_rgba(34,211,238,0.7)]'
                  : 'bg-slate-800'
              }`}
            />
          ))}
        </div>

        <div className="h-6 mb-3">
          {error && <p className="text-rose-400 text-sm font-medium">{error}</p>}
          {loading && <p className="text-cyan-400 text-sm animate-pulse">Verificando...</p>}
        </div>

        {/* Teclado numérico */}
        <div className="grid grid-cols-3 gap-3.5 w-full">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigit(num)}
              className="h-16 rounded-2xl bg-slate-900/90 hover:bg-slate-800 active:bg-cyan-500 active:text-slate-950 active:scale-95 text-2xl font-semibold ring-1 ring-white/5 transition-all"
            >
              {num}
            </button>
          ))}
          <div />
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-16 rounded-2xl bg-slate-900/90 hover:bg-slate-800 active:bg-cyan-500 active:text-slate-950 active:scale-95 text-2xl font-semibold ring-1 ring-white/5 transition-all"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => {
              if (!loading) setPin((prev) => prev.slice(0, -1));
            }}
            className="h-16 rounded-2xl bg-slate-900/40 hover:bg-slate-800 active:scale-95 flex items-center justify-center text-slate-400 transition-all"
            aria-label="Borrar"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

        <div className="mt-8 text-xs text-slate-500 text-center space-y-1">
          <p>
            Mesero <strong className="text-slate-300">1111</strong> · Cocina{' '}
            <strong className="text-slate-300">3333</strong>
          </p>
          <p>
            Barra <strong className="text-slate-300">4444</strong> · Dueño{' '}
            <strong className="text-slate-300">0000</strong>
          </p>
        </div>
      </div>
    </main>
  );
}
