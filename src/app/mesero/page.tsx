'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Usuario, Mesa, Categoria, Producto } from '@/lib/supabase';
import { playWaiterReadyAlert } from '@/lib/sound';
import { Bell, CheckCircle2, ChevronLeft, LogOut, Minus, Plus, ReceiptText, Send } from 'lucide-react';

interface ItemCarrito {
  producto: Producto;
  cantidad: number;
  notas: string;
}

interface ItemListo {
  id: string;
  cantidad: number;
  notas: string | null;
  productos: { nombre: string };
  cuentas: { mesero_id: string; mesas: { nombre: string } };
}

interface ItemPrevio {
  id: string;
  cantidad: number;
  notas: string | null;
  estado: string;
  productos: { nombre: string };
}

const NOTAS_RAPIDAS = ['Sin cebolla', 'Poco picante', 'Bien picante', 'Sin cilantro', 'Para llevar'];

export default function MeseroPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [itemsListos, setItemsListos] = useState<ItemListo[]>([]);

  const [mesaActiva, setMesaActiva] = useState<Mesa | null>(null);
  const [itemsPrevios, setItemsPrevios] = useState<ItemPrevio[]>([]);
  const [totalPrevio, setTotalPrevio] = useState<number>(0);

  const [catActiva, setCatActiva] = useState<string>('');
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [notaTemporal, setNotaTemporal] = useState('');
  const [productoParaNota, setProductoParaNota] = useState<Producto | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cargarDatos = useCallback(async (userId: string) => {
    const [resMesas, resCats, resProds, resListos] = await Promise.all([
      supabase.from('mesas').select('*').order('orden_visual'),
      supabase.from('categorias').select('*').order('orden_visual'),
      supabase.from('productos').select('*').eq('disponible', true).order('nombre'),
      supabase
        .from('comandas_items')
        .select('id, cantidad, notas, productos(nombre), cuentas!inner(mesero_id, mesas(nombre))')
        .eq('estado', 'listo')
        .eq('cuentas.mesero_id', userId),
    ]);

    if (resMesas.data) setMesas(resMesas.data);
    if (resCats.data) {
      setCategorias(resCats.data);
      setCatActiva((prev) => prev || resCats.data[0]?.id || '');
    }
    if (resProds.data) setProductos(resProds.data);
    if (resListos.data) setItemsListos(resListos.data as unknown as ItemListo[]);
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem('usuario_activo');
    if (!raw) {
      router.push('/');
      return;
    }
    const parsed: Usuario = JSON.parse(raw);
    setUsuario(parsed);
    cargarDatos(parsed.id);

    const channel = supabase
      .channel('mesero-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mesas' }, () => {
        cargarDatos(parsed.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => {
        cargarDatos(parsed.id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'comandas_items' }, (payload) => {
        if (payload.new.estado === 'listo') {
          playWaiterReadyAlert();
          cargarDatos(parsed.id);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, cargarDatos]);

  const abrirMesa = async (mesa: Mesa) => {
    setMesaActiva(mesa);
    setCarrito([]);
    setItemsPrevios([]);
    setTotalPrevio(0);

    if (mesa.estado === 'ocupada') {
      const { data } = await supabase
        .from('cuentas')
        .select('total, comandas_items(id, cantidad, notas, estado, productos(nombre))')
        .eq('mesa_id', mesa.id)
        .eq('estado', 'abierta')
        .maybeSingle();

      if (data) {
        setTotalPrevio(Number(data.total));
        setItemsPrevios((data.comandas_items as unknown as ItemPrevio[]) || []);
      }
    }
  };

  const agregarAlCarrito = (producto: Producto, notas = '') => {
    setCarrito((prev) => {
      const idx = prev.findIndex((i) => i.producto.id === producto.id && i.notas === notas);
      if (idx > -1) {
        const copia = [...prev];
        copia[idx].cantidad += 1;
        return copia;
      }
      return [...prev, { producto, cantidad: 1, notas }];
    });
    setProductoParaNota(null);
    setNotaTemporal('');
  };

  const cambiarCantidad = (index: number, delta: number) => {
    setCarrito((prev) => {
      const copia = [...prev];
      const nuevaCant = copia[index].cantidad + delta;
      if (nuevaCant <= 0) return copia.filter((_, i) => i !== index);
      copia[index].cantidad = nuevaCant;
      return copia;
    });
  };

  const enviarComanda = async () => {
    if (!mesaActiva || !usuario || carrito.length === 0 || enviando) return;
    setEnviando(true);

    try {
      let { data: cuenta } = await supabase
        .from('cuentas')
        .select('*')
        .eq('mesa_id', mesaActiva.id)
        .eq('estado', 'abierta')
        .maybeSingle();

      const subtotalNuevo = carrito.reduce((acc, i) => acc + i.producto.precio * i.cantidad, 0);

      if (!cuenta) {
        const { data: nuevaCuenta, error } = await supabase
          .from('cuentas')
          .insert({
            mesa_id: mesaActiva.id,
            mesero_id: usuario.id,
            total: subtotalNuevo,
          })
          .select()
          .single();

        if (error) throw error;
        cuenta = nuevaCuenta;
        await supabase.from('mesas').update({ estado: 'ocupada' }).eq('id', mesaActiva.id);
      } else {
        await supabase
          .from('cuentas')
          .update({ total: Number(cuenta.total) + subtotalNuevo })
          .eq('id', cuenta.id);
      }

      const itemsInsert = carrito.map((item) => ({
        cuenta_id: cuenta.id,
        producto_id: item.producto.id,
        cantidad: item.cantidad,
        precio_unitario: item.producto.precio,
        notas: item.notas || null,
      }));

      const { error: itemsError } = await supabase.from('comandas_items').insert(itemsInsert);
      if (itemsError) throw itemsError;

      setCarrito([]);
      setMesaActiva(null);
      cargarDatos(usuario.id);
    } catch (err) {
      alert('Error al enviar pedido. Revisa tu conexión Wi-Fi.');
      console.error(err);
    } finally {
      setEnviando(false);
    }
  };

  const marcarEntregado = async (itemId: string) => {
    await supabase.from('comandas_items').update({ estado: 'entregado' }).eq('id', itemId);
    if (usuario) cargarDatos(usuario.id);
  };

  if (!usuario) return null;

  return (
    <div className="min-h-dvh bg-slate-950 text-white pb-24 select-none">
      {/* Header limpio */}
      <header className="bg-slate-900/80 backdrop-blur-md px-4 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div>
          <p className="text-[11px] text-cyan-400 font-bold tracking-wider uppercase">Mesero</p>
          <h1 className="font-bold text-base leading-tight">{usuario.nombre}</h1>
        </div>
        <button
          onClick={() => {
            sessionStorage.removeItem('usuario_activo');
            router.push('/');
          }}
          className="p-2.5 text-slate-400 hover:text-white bg-slate-800/80 rounded-xl active:scale-95 transition"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Banner de Pedidos Listos */}
      {itemsListos.length > 0 && (
        <div className="bg-rose-500/15 px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-xs uppercase tracking-wide">
            <Bell className="w-4 h-4 animate-bounce" />
            <span>Pedidos listos para recoger</span>
          </div>
          {itemsListos.map((item) => (
            <div
              key={item.id}
              className="bg-slate-900 rounded-2xl p-3 flex items-center justify-between shadow-md ring-1 ring-rose-500/30"
            >
              <div>
                <span className="text-[11px] font-bold uppercase bg-rose-500 text-white px-2 py-0.5 rounded-md mr-2">
                  {item.cuentas.mesas.nombre}
                </span>
                <span className="font-semibold text-sm">
                  {item.cantidad}x {item.productos.nombre}
                </span>
                {item.notas && <p className="text-xs text-amber-300 mt-1">Nota: {item.notas}</p>}
              </div>
              <button
                onClick={() => marcarEntregado(item.id)}
                className="bg-emerald-500 active:scale-95 text-slate-950 px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1 transition"
              >
                <CheckCircle2 className="w-4 h-4" /> Entregado
              </button>
            </div>
          ))}
        </div>
      )}

      {/* VISTA 1: MAPA DE MESAS */}
      {!mesaActiva ? (
        <div className="p-4 max-w-xl mx-auto">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
            Selecciona una mesa
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {mesas.map((mesa) => {
              const ocupada = mesa.estado === 'ocupada';
              return (
                <button
                  key={mesa.id}
                  onClick={() => abrirMesa(mesa)}
                  className={`h-28 rounded-2xl p-4 flex flex-col justify-between text-left transition active:scale-95 shadow-sm ${
                    ocupada
                      ? 'bg-gradient-to-br from-amber-500/20 to-slate-900 ring-1 ring-amber-500/30'
                      : 'bg-slate-900 ring-1 ring-white/5 hover:bg-slate-800/80'
                  }`}
                >
                  <span className="text-lg font-bold">{mesa.nombre}</span>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-lg w-fit ${
                      ocupada
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-400'
                    }`}
                  >
                    {ocupada ? 'Ocupada' : 'Disponible'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* VISTA 2: TOMAR ORDEN DE MESA */
        <div className="p-4 max-w-xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setMesaActiva(null)}
              className="flex items-center gap-1 text-slate-300 bg-slate-900 px-3.5 py-2 rounded-xl text-sm font-semibold active:scale-95 transition"
            >
              <ChevronLeft className="w-4 h-4" /> Mesas
            </button>
            <span className="font-extrabold text-lg text-cyan-400">{mesaActiva.nombre}</span>
          </div>

          {/* Resumen si la mesa ya tenía consumo previo */}
          {itemsPrevios.length > 0 && (
            <details className="bg-slate-900/70 rounded-2xl p-3.5 ring-1 ring-amber-500/20">
              <summary className="flex items-center justify-between text-xs font-bold text-amber-300 cursor-pointer list-none">
                <span className="flex items-center gap-1.5">
                  <ReceiptText className="w-4 h-4" /> Ya pedido en esta mesa ({itemsPrevios.length})
                </span>
                <span>Acumulado: ${totalPrevio.toFixed(2)}</span>
              </summary>
              <div className="mt-2.5 pt-2.5 border-t border-white/5 space-y-1 text-xs text-slate-300">
                {itemsPrevios.map((prev) => (
                  <div key={prev.id} className="flex justify-between">
                    <span>
                      <strong>{prev.cantidad}x</strong> {prev.productos.nombre}
                    </span>
                    <span className="text-slate-400 capitalize">{prev.estado}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Categorías */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {categorias.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCatActiva(cat.id)}
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                  catActiva === cat.id
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                    : 'bg-slate-900 text-slate-300'
                }`}
              >
                {cat.nombre}
              </button>
            ))}
          </div>

          {/* Lista de Platillos */}
          <div className="space-y-2.5">
            {productos
              .filter((p) => p.categoria_id === catActiva)
              .map((prod) => (
                <div
                  key={prod.id}
                  className="bg-slate-900 rounded-2xl p-3.5 flex items-center justify-between ring-1 ring-white/5"
                >
                  <div className="pr-2">
                    <p className="font-semibold text-sm leading-snug">{prod.nombre}</p>
                    <p className="text-sm text-cyan-400 font-extrabold mt-0.5">
                      ${Number(prod.precio).toFixed(2)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setProductoParaNota(prod);
                        setNotaTemporal('');
                      }}
                      className="px-3 py-2.5 rounded-xl bg-slate-800 text-xs text-slate-300 font-semibold active:scale-95 transition"
                    >
                      + Nota
                    </button>
                    <button
                      onClick={() => agregarAlCarrito(prod)}
                      className="p-2.5 rounded-xl bg-cyan-500 text-slate-950 font-bold active:scale-90 transition shadow-sm"
                    >
                      <Plus className="w-5 h-5 stroke-[2.5]" />
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {/* Modal rápido de notas */}
          {productoParaNota && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-30 flex items-end sm:items-center justify-center p-4">
              <div className="bg-slate-900 rounded-3xl p-5 w-full max-w-md space-y-4 ring-1 ring-white/10">
                <h3 className="font-bold text-lg">{productoParaNota.nombre}</h3>
                <div className="flex flex-wrap gap-2">
                  {NOTAS_RAPIDAS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setNotaTemporal((prev) => (prev ? `${prev}, ${n}` : n))}
                      className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl font-medium"
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={notaTemporal}
                  onChange={(e) => setNotaTemporal(e.target.value)}
                  placeholder="Ej. Sin cebolla, tostadas aparte..."
                  className="w-full bg-slate-950 rounded-xl px-3.5 py-3 text-sm outline-none ring-1 ring-white/10 focus:ring-cyan-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setProductoParaNota(null)}
                    className="flex-1 py-3 rounded-xl bg-slate-800 font-semibold text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => agregarAlCarrito(productoParaNota, notaTemporal)}
                    className="flex-1 py-3 rounded-xl bg-cyan-500 text-slate-950 font-extrabold text-sm"
                  >
                    Agregar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Carrito listo para enviar */}
          {carrito.length > 0 && (
            <div className="bg-slate-900 rounded-3xl p-4 space-y-3 ring-1 ring-cyan-500/30 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-xs text-cyan-400 uppercase tracking-wider">
                  Nueva comanda
                </h3>
                <span className="text-sm font-extrabold text-white">
                  ${carrito.reduce((acc, i) => acc + i.producto.precio * i.cantidad, 0).toFixed(2)}
                </span>
              </div>

              <div className="space-y-2.5">
                {carrito.map((item, index) => (
                  <div key={index} className="flex items-center justify-between text-sm bg-slate-950/60 p-2.5 rounded-xl">
                    <div className="pr-2">
                      <p className="font-medium leading-tight">{item.producto.nombre}</p>
                      {item.notas && <p className="text-xs text-amber-300 mt-0.5">{item.notas}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => cambiarCantidad(index, -1)}
                        className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center active:scale-90"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="font-bold w-5 text-center">{item.cantidad}</span>
                      <button
                        onClick={() => cambiarCantidad(index, 1)}
                        className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center active:scale-90"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={enviarComanda}
                disabled={enviando}
                className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-98 text-slate-950 font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition"
              >
                <Send className="w-5 h-5" />
                {enviando
                  ? 'Enviando...'
                  : `ENVIAR COMANDA (${carrito.reduce((a, b) => a + b.cantidad, 0)})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}