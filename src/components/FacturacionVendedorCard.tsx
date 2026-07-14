import React from "react";

export interface FacturacionVendedorCardProps {
  nombreVendedor: string;
  pagado: number;
  ingresos: number;
  totalAPagar: number;
  totalPremios?: number;
  cobrado: number;
  vendido: number;
  ganancia: number;
  total: number;
  moneda?: string;
  onCardClick?: () => void;
}

export const FacturacionVendedorCard: React.FC<FacturacionVendedorCardProps> = ({
  nombreVendedor,
  pagado,
  ingresos,
  totalAPagar,
  totalPremios,
  cobrado,
  vendido,
  ganancia,
  total,
  moneda = "C$",
  onCardClick,
}) => {
  const formatCurrency = (value: number) => {
    return `${moneda} ${value.toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  return (
    <div 
      onClick={onCardClick}
      className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-4 transition-all duration-200 ${
        onCardClick ? "hover:shadow-md hover:border-blue-100 active:scale-[0.99] cursor-pointer" : ""
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-bold text-gray-800 tracking-tight">
          {nombreVendedor}
        </h3>
        <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-2.5 py-1 rounded-full uppercase tracking-wider">
          Resumen Corte
        </span>
      </div>

      {/* Body: 2 Columns Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left Column (Expenses / Cashflow) */}
        <div className="space-y-1.5 border-r border-gray-100 pr-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Pagado:</span>
            <span className="font-semibold text-gray-700">{formatCurrency(pagado)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Ingresos:</span>
            <span className="font-semibold text-gray-700">{formatCurrency(ingresos)}</span>
          </div>
          <div className="flex justify-between text-sm pt-1 border-t border-gray-50">
            <span className="text-gray-600 font-medium">Total a pagar:</span>
            <span className="font-bold text-gray-800">{formatCurrency(totalAPagar)}</span>
          </div>
          {typeof totalPremios === "number" && totalPremios > 0 && (
            <div className="flex justify-between text-sm bg-amber-50 -mx-1 px-1 py-0.5 rounded">
              <span className="text-amber-700 font-bold">Premios:</span>
              <span className="font-black text-amber-600">{formatCurrency(totalPremios)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Cobrado:</span>
            <span className="font-semibold text-gray-700">{formatCurrency(cobrado)}</span>
          </div>
        </div>

        {/* Right Column (Sales / Final Metrics) */}
        <div className="space-y-1.5 pl-2 flex flex-col justify-between">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Vendido:</span>
            <span className="font-semibold text-gray-700">{formatCurrency(vendido)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 font-semibold">Ganancia:</span>
            <span className="font-bold text-blue-700">{formatCurrency(ganancia)}</span>
          </div>
          <div className="flex justify-between text-base pt-1 border-t border-gray-50">
            <span className="text-gray-800 font-bold">Total:</span>
            <span className="font-black text-blue-700">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FacturacionVendedorCard;
