"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { playKitchenBell } from "@/lib/sound";
import { Delete, UtensilsCrossed } from "lucide-react";

export default function LoginPinPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleDigit = async (digit: string) => {
    if (pin.length >= 4 || loading) return;
    const nextPin = pin + digit;
    setPin(nextPin);
    setError("");

    if (nextPin.length === 4) {
      setLoading(true);
      // Desbloquea el permiso de audio del navegador en esta interacción
      playKitchenBell();

      const { data, error: dbError } = await supabase
        .from("usuarios")
        .select("*")
        .eq("pin_acceso", nextPin)
        .eq("activo", true)
        .single();

      if (dbError || !data) {
        // PGRST116 = la consulta funcionó, pero no encontró ese PIN
        if (dbError?.code === 'PGRST116') {
          setError('PIN incorrecto');
        } else {
          setError(`Error BD: ${dbError?.message || 'Sin respuesta'}`);
        }
        setPin('');
        setLoading(false);
        return;
      }

      sessionStorage.setItem("usuario_activo", JSON.stringify(data));

      if (data.rol === "mesero") router.push("/mesero");
      else if (data.rol === "cocina" || data.rol === "barra") router.push("/cocina");
      else router.push("/admin");
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-xs flex flex-col items-center">
        <div className="bg-cyan-500/10 p-4 rounded-2xl border border-cyan-500/30 mb-4">
          <UtensilsCrossed className="w-10 h-10 text-cyan-400" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Mariscos Comanda</h1>
        <p className="text-slate-400 text-sm mb-6">Ingresa tu PIN de 4 dígitos</p>

        {/* Indicadores de PIN */}
        <div className="flex gap-4 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all ${
                pin.length > i ? "bg-cyan-400 scale-110" : "bg-slate-800 border border-slate-700"
              }`}
            />
          ))}
        </div>

        <div className="h-6 mb-2">
          {error && <p className="text-rose-400 text-sm font-medium">{error}</p>}
          {loading && <p className="text-cyan-400 text-sm">Entrando...</p>}
        </div>

        {/* Teclado numérico */}
        <div className="grid grid-cols-3 gap-3 w-full">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <button
              key={num}
              onClick={() => handleDigit(num)}
              className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:bg-cyan-600 text-2xl font-semibold border border-slate-800 transition"
            >
              {num}
            </button>
          ))}
          <div />
          <button
            onClick={() => handleDigit("0")}
            className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:bg-cyan-600 text-2xl font-semibold border border-slate-800 transition"
          >
            0
          </button>
          <button
            onClick={() => setPin((prev) => prev.slice(0, -1))}
            className="h-16 rounded-2xl bg-slate-900/60 hover:bg-slate-800 flex items-center justify-center border border-slate-800 text-slate-400"
            aria-label="Borrar"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

        <div className="mt-8 text-xs text-slate-500 text-center space-y-1">
          <p>
            PINs de prueba: Mesero <strong className="text-slate-300">1111</strong> · Cocina{" "}
            <strong className="text-slate-300">3333</strong>
          </p>
          <p>
            Barra <strong className="text-slate-300">4444</strong> · Dueño{" "}
            <strong className="text-slate-300">0000</strong>
          </p>
        </div>
      </div>
    </main>
  );
}
