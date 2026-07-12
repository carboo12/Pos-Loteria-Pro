import React from "react";

export interface ResumenFacturacionCardProps {
  facturado: number;
  ingresos: number;
  aPagar: number;
  cobro: number;
  pagado: number;
  total: number;
  moneda?: string;
}

export const ResumenFacturacionCard: React.FC<ResumenFacturacionCardProps> = ({
  facturado,
  ingresos,
  aPagar,
  cobro,
  pagado,
  total,
  moneda = "C$",
}) => {
  const formatCurrency = (value: number) => {
    return `${moneda} ${value.toLocaleString("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-md border border-gray-100 max-w-md mx-auto w-full mb-6">
      {/* Metrics Grid 3x2 style but structured as Fila 1 (3 items), Separator, Fila 2 (2 items) */}
      
      {/* Row 1: Facturado, Ingresos, A Pagar */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wider block">
            Facturado
          </span>
          <span className="text-sm md:text-base font-black text-blue-600 block mt-1 break-all">
            {formatCurrency(facturado)}
          </span>
        </div>
        <div>
          <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wider block">
            Ingresos
          </span>
          <span className="text-sm md:text-base font-black text-green-600 block mt-1 break-all">
            {formatCurrency(ingresos)}
          </span>
        </div>
        <div>
          <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wider block">
            A Pagar
          </span>
          <span className="text-sm md:text-base font-black text-red-600 block mt-1 break-all">
            {formatCurrency(aPagar)}
          </span>
        </div>
      </div>

      {/* Separator */}
      <hr className="my-3 border-gray-200" />

      {/* Row 2: Cobro, Pagado */}
      <div className="grid grid-cols-2 gap-4 text-center">
        <div>
          <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wider block">
            Cobro
          </span>
          <span className="text-sm md:text-base font-black text-orange-500 block mt-1 break-all">
            {formatCurrency(cobro)}
          </span>
        </div>
        <div>
          <span className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-wider block">
            Pagado
          </span>
          <span className="text-sm md:text-base font-black text-blue-500 block mt-1 break-all">
            {formatCurrency(pagado)}
          </span>
        </div>
      </div>

      {/* Footer: Total */}
      <div className="text-center mt-5 pt-3 border-t border-gray-50">
        <span className="text-[11px] text-gray-400 font-extrabold uppercase tracking-widest block">
          Total
        </span>
        <span className="text-2xl md:text-3xl font-black text-blue-800 block mt-1">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
};

export default ResumenFacturacionCard;
