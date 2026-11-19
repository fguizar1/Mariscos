"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, Usuario } from "@/lib/supabase";
import { playKitchenBell } from "@/lib/sound";
import { Check, Clock, LogOut, Volume2 } from "lucide-react";

interface ComandaKDS {
  id: string;
  cantidad: number;
  notas: string | null;
  estado: string;
  creado_en: string;
  productos: {
    nombre: string;
    categorias: { area_destino: "cocina" | "barra" };
  };
  cuentas: {
    mesas: { nombre: string };
    usuarios: { nombre: string };
  };
}

export default function CocinaPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [comandas, setComandas] = useState<ComandaKDS[]>([]);
  const [ahora, setAhora] = useState<number>(0);

  const cargarComandas = useCallback(async (area: string) => {
    const { data } = await supabase
      .from("comandas_items")
      .select(
        `
        id, cantidad, notas, estado, creado_en,
        productos!inner(nombre, categorias!inner(area_destino)),
        cuentas!inner(mesas(nombre), usuarios(nombre))
      `,
      )
      .in("estado", ["pendiente", "preparando"])
      .eq("productos.categorias.area_destino", area)
      .order("creado_en", { ascending: true });

    if (data) setComandas(data as unknown as ComandaKDS[]);
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem("usuario_activo");
    if (!raw) {
      router.push("/");
      return;
    }
    const parsed: Usuario = JSON.parse(raw);
    setUsuario(parsed);
    const area = parsed.rol === "barra" ? "barra" : "cocina";
    cargarComandas(area);

    // Reloj para actualizar los minutos transcurridos en vivo
    const initTimer = setTimeout(() => setAhora(Date.now()), 0);
    const timer = setInterval(() => setAhora(Date.now()), 15000);

    // Escuchar nuevas comandas en tiempo real
    const channel = supabase
      .channel(`kds-${area}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comandas_items" }, () => {
        playKitchenBell();
        cargarComandas(area);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "comandas_items" }, () => {
        cargarComandas(area);
      })
      .subscribe();

    return () => {
      clearInterval(timer);
      clearTimeout(initTimer);
      supabase.removeChannel(channel);
    };
  }, [router, cargarComandas]);

  const marcarListo = async (id: string) => {
    await supabase.from("comandas_items").update({ estado: "listo", listo_en: new Date().toISOString() }).eq("id", id);

    if (usuario) {
      cargarComandas(usuario.rol === "barra" ? "barra" : "cocina");
    }
  };

  if (!usuario) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4">
      {/* Barra superior */}
      <header className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl px-5 py-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-emerald-400 animate-ping" />
          <h1 className="text-xl font-extrabold uppercase tracking-wide">
            Monitor {usuario.rol === "barra" ? "de Barra" : "de Cocina"}
          </h1>
          <span className="bg-slate-800 text-cyan-400 text-sm font-bold px-3 py-1 rounded-full">
            {comandas.length} pendientes
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={playKitchenBell}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl text-xs text-slate-300"
            title="Probar sonido de campana"
          >
            <Volume2 className="w-4 h-4 text-cyan-400" /> Probar timbre
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem("usuario_activo");
              router.push("/");
            }}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Cuadrícula de Comandas */}
      {comandas.length === 0 ? (
        <div className="h-[65vh] flex flex-col items-center justify-center text-slate-500">
          <p className="text-xl font-semibold">Sin pedidos pendientes</p>
          <p className="text-sm">Las órdenes de los meseros aparecerán aquí automáticamente</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {comandas.map((item) => {
            const minutos = ahora ? Math.max(0, Math.floor((ahora - new Date(item.creado_en).getTime()) / 60000)): 0;
            const urgente = minutos >= 15;
            const advertencia = minutos >= 8 && minutos < 15;

            return (
              <div
                key={item.id}
                className={`rounded-2xl p-5 flex flex-col justify-between transition shadow-lg border-l-4 ${
                  urgente
                    ? 'bg-rose-950/30 border-l-rose-500 ring-1 ring-rose-500/20'
                    : advertencia
                    ? 'bg-amber-950/20 border-l-amber-400 ring-1 ring-amber-400/20'
                    : 'bg-slate-900 border-l-cyan-400 ring-1 ring-white/5'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
                    <div>
                      <span className="text-xl font-black text-cyan-400">{item.cuentas.mesas.nombre}</span>
                      <p className="text-xs text-slate-400">Mesero: {item.cuentas.usuarios.nombre}</p>
                    </div>
                    <div
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
                        urgente
                          ? "bg-rose-600 text-white"
                          : advertencia
                            ? "bg-amber-500 text-slate-950"
                            : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      {minutos} min
                    </div>
                  </div>

                  <p className="text-2xl font-bold leading-snug">
                    <span className="text-cyan-400">{item.cantidad}x</span> {item.productos.nombre}
                  </p>

                  {item.notas && (
                    <div className="mt-3 bg-amber-500/20 border border-amber-500/40 rounded-xl px-3 py-2 text-amber-200 font-semibold text-sm">
                      ⚠️ {item.notas}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => marcarListo(item.id)}
                  className="mt-6 w-full py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-lg flex items-center justify-center gap-2 transition shadow-lg"
                >
                  <Check className="w-6 h-6 stroke-[3]" /> ¡LISTO!
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
