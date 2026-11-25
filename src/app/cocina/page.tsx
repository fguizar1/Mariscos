'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Usuario } from '@/lib/supabase';
import { playKitchenBell } from '@/lib/sound';
import { Check, ChefHat, Clock, Flame, LogOut, Volume2 } from 'lucide-react';

interface ComandaKDS {
  id: string;
  cantidad: number;
  notas: string | null;
  creado_en: string;
  productos: { nombre: string; categorias: { area_destino: string } };
  cuentas: { mesas: { nombre: string }; usuarios: { nombre: string } };
}

function formatearCronometro(ms: number): string {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

export default function CocinaPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [comandas, setComandas] = useState<ComandaKDS[]>([]);
  const [ahora, setAhora] = useState<number>(0);

  const cargarComandas = useCallback(async (area: string) => {
    const { data } = await supabase
      .from('comandas_items')
      .select(`
        id, cantidad, notas, creado_en,
        productos!inner(nombre, categorias!inner(area_destino)),
        cuentas!inner(mesas(nombre), usuarios(nombre))
      `)
      .eq('estado', 'pendiente')
      .eq('productos.categorias.area_destino', area)
      .order('creado_en', { ascending: true });

    if (data) setComandas(data as unknown as ComandaKDS[]);
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem('usuario_activo');
    if (!raw) {
      router.push('/');
      return;
    }
    const parsed: Usuario = JSON.parse(raw);
    setUsuario(parsed);

    const area = parsed.rol === 'barra' ? 'barra' : 'cocina';
    cargarComandas(area);

    // Reloj en vivo cada segundo para el cronómetro
    const initTimer = setTimeout(() => setAhora(Date.now()), 0);
    const timer = setInterval(() => setAhora(Date.now()), 1000);

    const channel = supabase
      .channel(`kds-${area}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comandas_items' }, () => {
        try {
          playKitchenBell();
        } catch {
          // Ignorar bloqueo de audio
        }
        cargarComandas(area);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comandas_items' }, () => {
        cargarComandas(area);
      })
      .subscribe();

    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [router, cargarComandas]);

  const marcarListo = async (id: string) => {
    setComandas((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('comandas_items').update({ estado: 'listo' }).eq('id', id);
  };

  if (!usuario) return null;

  return (
    <div className="min-h-dvh bg-slate-950 text-white p-4 select-none">
      {/* Header */}
      <header className="flex items-center justify-between bg-slate-900/90 backdrop-blur-md p-4 rounded-2xl mb-5 ring-1 ring-white/5">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500/15 p-2.5 rounded-xl">
            <ChefHat className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight uppercase">
              {usuario.rol === 'barra' ? 'Barra y Bebidas' : 'Monitor de Cocina'}
            </h1>
            <p className="text-xs text-slate-400">
              {comandas.length === 0
                ? 'Sin pedidos pendientes'
                : `${comandas.length} ${comandas.length === 1 ? 'pedido en fila' : 'pedidos en fila'} · Orden de llegada`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => playKitchenBell()}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 px-3 py-2.5 rounded-xl text-xs font-semibold text-cyan-300 active:scale-95 transition"
          >
            <Volume2 className="w-4 h-4" /> Timbre
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem('usuario_activo');
              window.location.href = '/';
            }}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 active:scale-95 transition"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Cola de Comandas (FIFO) */}
      {comandas.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[62vh] text-slate-500">
          <ChefHat className="w-16 h-16 mb-3 opacity-20" />
          <p className="text-lg font-semibold">Todo al día, sin comandas pendientes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {comandas.map((item, index) => {
            const msTranscurridos = ahora ? Math.max(0, ahora - new Date(item.creado_en).getTime()) : 0;
            const minutos = Math.floor(msTranscurridos / 60000);
            const esPrimero = index === 0;
            const urgente = minutos >= 15;
            const advertencia = minutos >= 8 && minutos < 15;

            const horaPedido = new Date(item.creado_en).toLocaleTimeString('es-MX', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={item.id}
                className={`rounded-2xl p-5 flex flex-col justify-between transition shadow-lg border-l-4 ${urgente
                    ? 'bg-rose-950/30 border-l-rose-500 ring-1 ring-rose-500/30'
                    : advertencia
                      ? 'bg-amber-950/20 border-l-amber-400 ring-1 ring-amber-400/20'
                      : esPrimero
                        ? 'bg-slate-900 border-l-emerald-400 ring-1 ring-emerald-400/25'
                        : 'bg-slate-900 border-l-cyan-400 ring-1 ring-white/5'
                  }`}
              >
                <div>
                  {/* Fila superior: Turno en cola + Cronómetro */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span
                      className={`text-xs font-black px-2.5 py-1 rounded-lg uppercase tracking-wide flex items-center gap-1 ${esPrimero
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                        }`}
                    >
                      {esPrimero && <Flame className="w-3.5 h-3.5" />}
                      #{index + 1} {esPrimero ? 'Sale primero' : 'En fila'}
                    </span>

                    <span
                      className={`flex items-center gap-1.5 text-sm font-mono font-extrabold px-2.5 py-1 rounded-lg ${urgente
                          ? 'bg-rose-500 text-white animate-pulse'
                          : advertencia
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-slate-800 text-cyan-300'
                        }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      {formatearCronometro(msTranscurridos)}
                    </span>
                  </div>

                  {/* Mesa y hora de entrada */}
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-2xl font-black text-cyan-400">
                      {item.cuentas.mesas.nombre}
                    </span>
                    <span className="text-xs text-slate-400">
                      Pedido {horaPedido} · {item.cuentas.usuarios.nombre.split(' ')[0]}
                    </span>
                  </div>

                  {/* Platillo y cantidad */}
                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="text-4xl font-black text-white">{item.cantidad}x</span>
                    <span className="text-xl font-bold leading-snug">{item.productos.nombre}</span>
                  </div>

                  {/* Notas especiales */}
                  {item.notas && (
                    <div className="bg-amber-400/15 rounded-xl p-3 mb-4 ring-1 ring-amber-400/30">
                      <p className="text-amber-300 font-bold text-sm">⚠️ {item.notas}</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => marcarListo(item.id)}
                  className="w-full py-4 mt-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-base flex items-center justify-center gap-2 transition shadow-md"
                >
                  <Check className="w-5 h-5 stroke-[3]" /> MARCAR LISTO
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}