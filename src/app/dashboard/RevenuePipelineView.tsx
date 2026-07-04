import React, { useState, useEffect } from "react";
import { FaFileInvoiceDollar, FaCheckCircle, FaSearch, FaDownload } from "react-icons/fa";
import { motion } from "framer-motion";

export default function RevenuePipelineView({ isDark, theme }: { isDark: boolean; theme: any }) {
  const [pipelineData, setPipelineData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/revenue-pipeline")
      .then(res => res.json())
      .then(json => {
        if (json.success) setPipelineData(json.data);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Error fetching pipeline:", err);
        setIsLoading(false);
      });
  }, []);

  const safeVal = (v: any) => (!v || v === "null" || v === "undefined") ? "—" : String(v);

  return (
    <div className={`p-4 md:p-6 w-full h-full min-h-screen ${theme.mainBg}`}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className={`text-2xl font-bold ${theme.accentText}`}>Revenue Pipeline</h1>
          <p className={`text-sm mt-1 ${theme.textMuted}`}>Track financial milestones and registration progress.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold ${theme.btnPrimary}`}>
            <FaDownload /> Export CSV
          </button>
        </div>
      </div>

      <div className={`rounded-2xl border overflow-hidden ${theme.tableWrap} ${theme.tableGlass}`}>
        <div className="overflow-x-auto">
          <table className={`w-full text-left text-sm ${theme.tableDivide}`}>
            <thead className={theme.tableHead}>
              <tr>
                <th className={`px-4 py-4 font-bold ${theme.text}`}>Booking ID</th>
                <th className={`px-4 py-4 font-bold ${theme.text}`}>Customer</th>
                <th className={`px-4 py-4 font-bold ${theme.text}`}>Unit</th>
                <th className={`px-4 py-4 font-bold ${theme.text}`}>Value</th>
                <th className={`px-4 py-4 font-bold ${theme.text}`}>OCR / SDR</th>
                <th className={`px-4 py-4 font-bold ${theme.text}`}>Loan Req.</th>
                <th className={`px-4 py-4 font-bold ${theme.text}`}>Stage</th>
              </tr>
            </thead>
            <tbody className={theme.tableDivide}>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="text-center py-10">Loading pipeline data...</td>
                </tr>
              ) : pipelineData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10">No bookings in pipeline yet.</td>
                </tr>
              ) : (
                pipelineData.map((b: any, i: number) => (
                  <tr key={i} className={`transition-colors ${theme.tableRow}`}>
                    <td className={`px-4 py-4 whitespace-nowrap ${theme.text}`}>
                      <span className="font-bold">{b.booking_number || `BKG-${b.booking_id}`}</span>
                    </td>
                    <td className={`px-4 py-4 ${theme.text}`}>
                      <p className="font-bold">{b.customer_name}</p>
                      <p className={`text-xs ${theme.textMuted}`}>{b.sales_manager}</p>
                    </td>
                    <td className={`px-4 py-4 ${theme.text}`}>
                      <p>{b.project || "—"}</p>
                      <p className={`text-xs ${theme.textMuted}`}>{b.wing} • {b.flat_number}</p>
                    </td>
                    <td className={`px-4 py-4 ${theme.text}`}>
                      <p className="font-bold">₹{b.agreement_value || 0}</p>
                      <p className={`text-xs ${theme.textMuted}`}>Bkg: ₹{b.booking_amount || 0}</p>
                    </td>
                    <td className={`px-4 py-4 ${theme.text}`}>
                      <p>OCR: {b.ocr_amount ? `₹${b.ocr_amount}` : "Pending"}</p>
                      <p className={`text-xs ${theme.textMuted}`}>SDR: {b.sdr_amount ? `₹${b.sdr_amount}` : "Pending"}</p>
                    </td>
                    <td className={`px-4 py-4 ${theme.text}`}>
                      {b.loan_amount ? `₹${b.loan_amount}` : "N/A"}
                    </td>
                    <td className={`px-4 py-4`}>
                      <span className={`px-2 py-1 text-xs font-bold rounded-full ${isDark ? "bg-[#9E217B]/20 text-[#d946a8]" : "bg-[#9E217B]/10 text-[#9E217B]"}`}>
                        {b.current_stage || "Booking Confirmed"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
