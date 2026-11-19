'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Usuario, Mesa, Categoria, Producto } from '@/lib/supabase';
import { playWaiterReadyAlert } from '@/lib/sound';
import { Bell, CheckCircle2, ChevronLeft, LogOut, Plus, Send, Trash2 } from 'lucide-react';

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

const NOTAS_RAPIDAS = ['Sin cebolla', 'Poco picante', 'Bien picante', 'Sin cilantro', 'Para llevar'];

export default function MeseroPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [itemsListos, setItemsListos] = useState<ItemListo[]>([]);

  // Estado para tomar orden en una mesa
  const [mesaActiva, setMesaActiva] = useState<Mesa | null>(null);
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

  const enviarComanda = async () => {
    if (!mesaActiva || !usuario || carrito.length === 0 || enviando) return;
    setEnviando(true);

    try {
      // 1. Buscar si la mesa ya tiene una cuenta abierta
      let { data: cuenta } = await supabase
        .from('cuentas')
        .select('*')
        .eq('mesa_id', mesaActiva.id)
        .eq('estado', 'abierta')
        .maybeSingle();

      const subtotalNuevo = carrito.reduce((acc, i) => acc + i.producto.precio * i.cantidad, 0);

      // 2. Si no existe cuenta abierta, crearla y ocupar mesa
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

      // 3. Insertar los ítems (esto dispara el timbre en Cocina/Barra)
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
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div>
          <p className="text-xs text-cyan-400 font-medium">MESERO</p>
          <h1 className="font-bold text-lg">{usuario.nombre}</h1>
        </div>
        <button
          onClick={() => {
            sessionStorage.removeItem('usuario_activo');
            router.push('/');
          }}
          className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-xl"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Banner de Pedidos Listos para recoger */}
      {itemsListos.length > 0 && (
        <div className="bg-rose-600/20 border-b border-rose-500/40 p-3 space-y-2">
          <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
            <Bell className="w-4 h-4 animate-bounce" />
            <span>¡PEDIDOS LISTOS EN BARRA / COCINA!</span>
          </div>
          {itemsListos.map((item) => (
            <div
              key={item.id}
              className="bg-slate-900 border border-rose-500/50 rounded-xl p-3 flex items-center justify-between"
            >
              <div>
                <span className="text-xs font-bold uppercase bg-rose-600 px-2 py-0.5 rounded mr-2">
                  {item.cuentas.mesas.nombre}
                </span>
                <span className="font-semibold">
                  {item.cantidad}x {item.productos.nombre}
                </span>
                {item.notas && <p className="text-xs text-amber-300 mt-1">Nota: {item.notas}</p>}
              </div>
              <button
                onClick={() => marcarEntregado(item.id)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1"
              >
                <CheckCircle2 className="w-4 h-4" /> Entregado
              </button>
            </div>
          ))}
        </div>
      )}

      {/* VISTA 1: MAPA DE MESAS */}
      {!mesaActiva ? (
        <div className="p-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Selecciona una mesa
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {mesas.map((mesa) => {
              const ocupada = mesa.estado === 'ocupada';
              return (
                <button
                  key={mesa.id}
                  onClick={() => {
                    setMesaActiva(mesa);
                    setCarrito([]);
                  }}
                  className={`h-28 rounded-2xl p-4 flex flex-col justify-between text-left border transition active:scale-95 ${
                    ocupada
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-100'
                      : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-100'
                  }`}
                >
                  <span className="text-lg font-bold">{mesa.nombre}</span>
                  <span
                    className={`text-xs font-semibold uppercase px-2 py-1 rounded-lg w-fit ${
                      ocupada ? 'bg-amber-500/30 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {ocupada ? 'Ocupada' : 'Libre'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* VISTA 2: TOMAR ORDEN DE MESA */
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setMesaActiva(null)}
              className="flex items-center gap-1 text-slate-300 bg-slate-900 px-3 py-2 rounded-xl border border-slate-800"
            >
              <ChevronLeft className="w-5 h-5" /> Mesas
            </button>
            <span className="font-bold text-lg text-cyan-400">{mesaActiva.nombre}</span>
          </div>

          {/* Categorías */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categorias.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCatActiva(cat.id)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                  catActiva === cat.id
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-slate-900 text-slate-300 border border-slate-800'
                }`}
              >
                {cat.nombre}
              </button>
            ))}
          </div>

          {/* Lista de Platillos */}
          <div className="space-y-2">
            {productos
              .filter((p) => p.categoria_id === catActiva)
              .map((prod) => (
                <div
                  key={prod.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold">{prod.nombre}</p>
                    <p className="text-sm text-cyan-400 font-bold">${Number(prod.precio).toFixed(2)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setProductoParaNota(prod);
                        setNotaTemporal('');
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-800 text-xs text-slate-300 font-medium"
                    >
                      + Nota
                    </button>
                    <button
                      onClick={() => agregarAlCarrito(prod)}
                      className="p-3 rounded-xl bg-cyan-500 text-slate-950 font-bold active:scale-95"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {/* Modal rápido de notas */}
          {productoParaNota && (
            <div className="fixed inset-0 bg-black/80 z-30 flex items-end p-4">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 w-full space-y-3">
                <h3 className="font-bold text-lg">{productoParaNota.nombre}</h3>
                <div className="flex flex-wrap gap-2">
                  {NOTAS_RAPIDAS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setNotaTemporal((prev) => (prev ? `${prev}, ${n}` : n))}
                      className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700"
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
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setProductoParaNota(null)}
                    className="flex-1 py-3 rounded-xl bg-slate-800 font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => agregarAlCarrito(productoParaNota, notaTemporal)}
                    className="flex-1 py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold"
                  >
                    Agregar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Resumen de orden actual antes de enviar */}
          {carrito.length > 0 && (
            <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-4 space-y-3 mt-4">
              <h3 className="font-bold text-sm text-cyan-400 uppercase">Por enviar a preparación</h3>
              {carrito.map((item, index) => (
                <div key={index} className="flex items-center justify-between text-sm border-b border-slate-800 pb-2">
                  <div>
                    <span className="font-bold">{item.cantidad}x</span> {item.producto.nombre}
                    {item.notas && <p className="text-xs text-amber-300">({item.notas})</p>}
                  </div>
                  <button
                    onClick={() => setCarrito((prev) => prev.filter((_, i) => i !== index))}
                    className="text-rose-400 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={enviarComanda}
                disabled={enviando}
                className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-base flex items-center justify-center gap-2 shadow-lg"
              >
                <Send className="w-5 h-5" />
                {enviando ? 'Enviando...' : `ENVIAR COMANDA (${carrito.reduce((a, b) => a + b.cantidad, 0)})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}