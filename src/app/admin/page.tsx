'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, Usuario, Producto, Categoria } from '@/lib/supabase';
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  DollarSign,
  LogOut,
  PlusCircle,
  Receipt,
  RefreshCw,
  Smartphone,
  Utensils,
} from 'lucide-react';

interface ItemCuenta {
  id: string;
  cantidad: number;
  precio_unitario: number;
  notas: string | null;
  estado: string;
  productos: { nombre: string };
}

interface CuentaAbierta {
  id: string;
  mesa_id: string;
  total: number;
  creada_en: string;
  mesas: { nombre: string };
  usuarios: { nombre: string };
  comandas_items: ItemCuenta[];
}

interface CuentaPagada {
  id: string;
  total: number;
  metodo_pago: 'efectivo' | 'tarjeta' | 'transferencia' | null;
  cerrada_en: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [tab, setTab] = useState<'caja' | 'corte' | 'menu'>('caja');

  // Datos operativos
  const [cuentasAbiertas, setCuentasAbiertas] = useState<CuentaAbierta[]>([]);
  const [cuentasHoy, setCuentasHoy] = useState<CuentaPagada[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  // Modal de cobro
  const [cuentaACobrar, setCuentaACobrar] = useState<CuentaAbierta | null>(null);
  const [metodoPago, setMetodoPago] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo');
  const [procesando, setProcesando] = useState(false);

  // Formulario rápido para agregar platillo
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');
  const [nuevaCatId, setNuevaCatId] = useState('');

  const cargarTodo = useCallback(async () => {
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);

    const [resAbiertas, resPagadas, resProds, resCats] = await Promise.all([
      supabase
        .from('cuentas')
        .select(`
          id, mesa_id, total, creada_en,
          mesas(nombre),
          usuarios(nombre),
          comandas_items(id, cantidad, precio_unitario, notas, estado, productos(nombre))
        `)
        .eq('estado', 'abierta')
        .order('creada_en', { ascending: true }),
      supabase
        .from('cuentas')
        .select('id, total, metodo_pago, cerrada_en')
        .eq('estado', 'pagada')
        .gte('cerrada_en', inicioDia.toISOString()),
      supabase.from('productos').select('*').order('nombre'),
      supabase.from('categorias').select('*').order('orden_visual'),
    ]);

    if (resAbiertas.data) setCuentasAbiertas(resAbiertas.data as unknown as CuentaAbierta[]);
    if (resPagadas.data) setCuentasHoy(resPagadas.data as CuentaPagada[]);
    if (resProds.data) setProductos(resProds.data);
    if (resCats.data) {
      setCategorias(resCats.data);
      setNuevaCatId((prev) => prev || resCats.data[0]?.id || '');
    }
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem('usuario_activo');
    if (!raw) {
      router.push('/');
      return;
    }
    const parsed: Usuario = JSON.parse(raw);
    if (parsed.rol !== 'admin') {
      router.push('/');
      return;
    }
    setUsuario(parsed);
    cargarTodo();

    const channel = supabase
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas' }, () => cargarTodo())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comandas_items' }, () => cargarTodo())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, cargarTodo]);

  const confirmarCobro = async () => {
    if (!cuentaACobrar || procesando) return;
    setProcesando(true);

    try {
      // 1. Marcar cuenta como pagada
      await supabase
        .from('cuentas')
        .update({
          estado: 'pagada',
          metodo_pago: metodoPago,
          cerrada_en: new Date().toISOString(),
        })
        .eq('id', cuentaACobrar.id);

      // 2. Liberar la mesa
      await supabase.from('mesas').update({ estado: 'libre' }).eq('id', cuentaACobrar.mesa_id);

      // 3. Limpiar alertas pendientes de esa cuenta
      await supabase
        .from('comandas_items')
        .update({ estado: 'entregado' })
        .eq('cuenta_id', cuentaACobrar.id)
        .neq('estado', 'entregado');

      setCuentaACobrar(null);
      await cargarTodo();
    } catch (err) {
      alert('Error al cerrar la mesa');
      console.error(err);
    } finally {
      setProcesando(false);
    }
  };

  const toggleDisponibilidad = async (prod: Producto) => {
    await supabase
      .from('productos')
      .update({ disponible: !prod.disponible })
      .eq('id', prod.id);
    cargarTodo();
  };

  const agregarProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim() || !nuevoPrecio || !nuevaCatId) return;

    await supabase.from('productos').insert({
      nombre: nuevoNombre.trim(),
      precio: parseFloat(nuevoPrecio),
      categoria_id: nuevaCatId,
    });

    setNuevoNombre('');
    setNuevoPrecio('');
    cargarTodo();
  };

  // Cálculos del corte del día
  const totalVendidoHoy = cuentasHoy.reduce((acc, c) => acc + Number(c.total), 0);
  const totalEfectivo = cuentasHoy
    .filter((c) => c.metodo_pago === 'efectivo')
    .reduce((acc, c) => acc + Number(c.total), 0);
  const totalTarjeta = cuentasHoy
    .filter((c) => c.metodo_pago === 'tarjeta')
    .reduce((acc, c) => acc + Number(c.total), 0);
  const totalTransferencia = cuentasHoy
    .filter((c) => c.metodo_pago === 'transferencia')
    .reduce((acc, c) => acc + Number(c.total), 0);
  const dineroEnMesasAbiertas = cuentasAbiertas.reduce((acc, c) => acc + Number(c.total), 0);

  if (!usuario) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-20">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div>
          <p className="text-xs text-amber-400 font-semibold uppercase">Administración y Caja</p>
          <h1 className="font-bold text-lg">{usuario.nombre}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargarTodo}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300"
            title="Actualizar"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem('usuario_activo');
              router.push('/');
            }}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Navegación por pestañas */}
      <nav className="grid grid-cols-3 gap-2 p-4 max-w-3xl mx-auto">
        <button
          onClick={() => setTab('caja')}
          className={`py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
            tab === 'caja' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-300'
          }`}
        >
          <Receipt className="w-4 h-4" /> Mesas ({cuentasAbiertas.length})
        </button>
        <button
          onClick={() => setTab('corte')}
          className={`py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
            tab === 'corte' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-300'
          }`}
        >
          <DollarSign className="w-4 h-4" /> Corte Hoy
        </button>
        <button
          onClick={() => setTab('menu')}
          className={`py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
            tab === 'menu' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-900 text-slate-300'
          }`}
        >
          <Utensils className="w-4 h-4" /> Menú
        </button>
      </nav>

      <main className="px-4 max-w-3xl mx-auto">
        {/* PESTAÑA 1: COBRO DE MESAS ABIERTAS */}
        {tab === 'caja' && (
          <div className="space-y-4">
            {cuentasAbiertas.length === 0 ? (
              <div className="bg-slate-900 rounded-2xl p-8 text-center text-slate-400">
                <p className="font-semibold text-white">No hay mesas abiertas en este momento</p>
                <p className="text-sm mt-1">Cuando un mesero abra una mesa, aparecerá aquí lista para cobrar.</p>
              </div>
            ) : (
              cuentasAbiertas.map((cuenta) => (
                <div key={cuenta.id} className="bg-slate-900 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-black text-cyan-400">{cuenta.mesas.nombre}</h2>
                      <p className="text-xs text-slate-400">Atiende: {cuenta.usuarios.nombre}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Total acumulado</p>
                      <p className="text-2xl font-black text-emerald-400">
                        ${Number(cuenta.total).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Desglose de lo consumido */}
                  <div className="bg-slate-950 rounded-xl p-3 space-y-1.5 text-sm">
                    {cuenta.comandas_items.map((item) => (
                      <div key={item.id} className="flex justify-between">
                        <span>
                          <strong className="text-cyan-400">{item.cantidad}x</strong> {item.productos.nombre}
                        </span>
                        <span className="text-slate-300">
                          ${(item.cantidad * Number(item.precio_unitario)).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      setCuentaACobrar(cuenta);
                      setMetodoPago('efectivo');
                    }}
                    className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-base flex items-center justify-center gap-2 transition"
                  >
                    <CheckCircle2 className="w-5 h-5" /> COBRAR Y LIBERAR MESA
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* PESTAÑA 2: CORTE DEL DÍA */}
        {tab === 'corte' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-emerald-600/20 to-slate-900 rounded-2xl p-6 text-center">
              <p className="text-sm text-emerald-300 font-semibold uppercase">Venta cobrada hoy</p>
              <p className="text-4xl font-black text-white mt-1">${totalVendidoHoy.toFixed(2)}</p>
              <p className="text-xs text-slate-400 mt-2">
                {cuentasHoy.length} cuentas cerradas · ${dineroEnMesasAbiertas.toFixed(2)} aún en mesas abiertas
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-900 rounded-2xl p-4">
                <Banknote className="w-5 h-5 text-emerald-400 mb-1" />
                <p className="text-xs text-slate-400">Efectivo</p>
                <p className="text-lg font-bold">${totalEfectivo.toFixed(2)}</p>
              </div>
              <div className="bg-slate-900 rounded-2xl p-4">
                <CreditCard className="w-5 h-5 text-cyan-400 mb-1" />
                <p className="text-xs text-slate-400">Tarjeta</p>
                <p className="text-lg font-bold">${totalTarjeta.toFixed(2)}</p>
              </div>
              <div className="bg-slate-900 rounded-2xl p-4">
                <Smartphone className="w-5 h-5 text-purple-400 mb-1" />
                <p className="text-xs text-slate-400">Transfer.</p>
                <p className="text-lg font-bold">${totalTransferencia.toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA 3: MENÚ Y AGOTADOS */}
        {tab === 'menu' && (
          <div className="space-y-6">
            {/* Alta rápida de nuevo platillo */}
            <form onSubmit={agregarProducto} className="bg-slate-900 rounded-2xl p-4 space-y-3">
              <h2 className="font-bold text-sm text-cyan-400 uppercase">Agregar platillo o bebida</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Nombre (ej. Torre de Mariscos)"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  className="bg-slate-950 rounded-xl px-3 py-2.5 text-sm outline-none"
                  required
                />
                <input
                  type="number"
                  step="0.5"
                  placeholder="Precio ($)"
                  value={nuevoPrecio}
                  onChange={(e) => setNuevoPrecio(e.target.value)}
                  className="bg-slate-950 rounded-xl px-3 py-2.5 text-sm outline-none"
                  required
                />
                <select
                  value={nuevaCatId}
                  onChange={(e) => setNuevaCatId(e.target.value)}
                  className="bg-slate-950 rounded-xl px-3 py-2.5 text-sm outline-none"
                >
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-cyan-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2"
              >
                <PlusCircle className="w-4 h-4" /> Guardar en el menú
              </button>
            </form>

            {/* Lista para prender/apagar platillos */}
            <div className="space-y-2">
              <h2 className="font-bold text-sm text-slate-400 uppercase">Disponibilidad en tiempo real</h2>
              {productos.map((prod) => (
                <div
                  key={prod.id}
                  className="bg-slate-900 rounded-xl p-3 flex items-center justify-between"
                >
                  <div>
                    <p className={`font-semibold ${!prod.disponible ? 'line-through text-slate-500' : ''}`}>
                      {prod.nombre}
                    </p>
                    <p className="text-xs text-cyan-400 font-bold">${Number(prod.precio).toFixed(2)}</p>
                  </div>
                  <button
                    onClick={() => toggleDisponibilidad(prod)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      prod.disponible
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {prod.disponible ? 'Disponible' : 'AGOTADO'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modal de confirmación de cobro */}
      {cuentaACobrar && (
        <div className="fixed inset-0 bg-black/80 z-30 flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="text-xl font-bold">Cerrar {cuentaACobrar.mesas.nombre}</h3>
            <div className="bg-slate-950 rounded-xl p-4 text-center">
              <p className="text-xs text-slate-400">Total a cobrar</p>
              <p className="text-3xl font-black text-emerald-400">
                ${Number(cuentaACobrar.total).toFixed(2)}
              </p>
            </div>

            <div>
              <p className="text-xs text-slate-400 mb-2">Método de pago:</p>
              <div className="grid grid-cols-3 gap-2">
                {(['efectivo', 'tarjeta', 'transferencia'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetodoPago(m)}
                    className={`py-2.5 rounded-xl text-xs font-bold capitalize transition ${
                      metodoPago === m ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setCuentaACobrar(null)}
                className="flex-1 py-3 rounded-xl bg-slate-800 font-semibold text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCobro}
                disabled={procesando}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-slate-950 font-black text-sm"
              >
                {procesando ? 'Cobrando...' : 'Confirmar Pago'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
