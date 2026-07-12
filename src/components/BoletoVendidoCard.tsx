import React from "react";

export interface BoletoVendidoCardProps {
  nombreVendedor: string;
  fecha: string;
  badges: string[]; // List of strings for the pills
  montoTotal: number;
  moneda?: string;
  onCardClick?: () => void;
}

export const BoletoVendidoCard: React.FC<BoletoVendidoCardProps> = ({
  nombreVendedor,
  fecha,
  badges,
  montoTotal,
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
      className={`bg-white rounded-xl p-4 shadow-sm border border-gray-150 mb-3 transition-all duration-200 ${
        onCardClick ? "hover:shadow-md hover:border-blue-100 active:scale-[0.99] cursor-pointer" : ""
      }`}
    >
      {/* Top Row: Seller and Date */}
      <div className="flex justify-between items-center mb-3">
        <span className="font-bold text-gray-800 text-sm tracking-tight uppercase">
          {nombreVendedor}
        </span>
        <span className="text-xs text-gray-400 font-medium">
          {fecha}
        </span>
      </div>

      {/* Middle Row: Badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        {badges.map((badge, idx) => {
          // Alternative styling to make the first badge blue and others gray as per Stitch UI guidance
          const isFirst = idx === 0;
          return (
            <span
              key={idx}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md border tracking-wide transition-colors ${
                isFirst
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-gray-50 text-gray-700 border-gray-200"
              }`}
            >
              {badge}
            </span>
          );
        })}
      </div>

      {/* Thin Separator */}
      <hr className="border-gray-100 my-2" />

      {/* Bottom Row: Total */}
      <div className="flex items-center text-gray-800 text-sm font-bold mt-2">
        <span className="text-gray-400 mr-1.5 font-normal">=</span>
        <span className="text-base font-black tracking-tight">
          {formatCurrency(montoTotal)}
        </span>
      </div>
    </div>
  );
};

export default BoletoVendidoCard;
