import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaInfoCircle, FaExclamationTriangle, FaTimes } from "react-icons/fa";

interface MarkClosingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDark?: boolean;
}

export default function MarkClosingModal({ isOpen, onClose, onConfirm, isDark = false }: MarkClosingModalProps) {
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState(false);

  const REQUIRED_SENTENCE = "YES, THE LEAD HAS BOOKED THE APPOINTMENT. THUS, CLOSING THE LEAD.";

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setInputText("");
      setError(false);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (inputText.trim() !== REQUIRED_SENTENCE) {
      setError(true);
      return;
    }
    setError(false);
    onConfirm();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div 
            initial={{ scale: 0.9, y: 20 }} 
            animate={{ scale: 1, y: 0 }} 
            exit={{ scale: 0.9, y: 20 }} 
            className={`w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border ${isDark ? "bg-[#111] border-[#222]" : "bg-white border-gray-200"}`}
          >
            {/* Header */}
            <div className={`flex justify-between items-center p-4 border-b ${isDark ? "border-[#222] bg-[#1a1a1a]" : "border-gray-100 bg-[#F8FAFC]"}`}>
              <h3 className={`font-bold text-lg flex items-center gap-2 ${isDark ? "text-white" : "text-gray-900"}`}>
                <FaInfoCircle className="text-orange-500" /> Mark Lead as Closing
              </h3>
              <button onClick={onClose} className={`p-1 rounded-lg transition-colors ${isDark ? "text-gray-400 hover:bg-[#222]" : "text-gray-500 hover:bg-gray-200"}`}>
                <FaTimes />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 flex flex-col gap-5">
              {/* Info Box */}
              <div className={`p-4 rounded-xl border ${isDark ? "bg-orange-500/10 border-orange-500/20 text-orange-200" : "bg-orange-50 border-orange-200 text-orange-800"}`}>
                <p className="text-sm mb-1">
                  Please carefully read the sentence below and rewrite it in your own words to confirm that this lead is ready to be closed.
                </p>
                <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                  This helps ensure that the lead is genuinely closing and not marked by mistake.
                </p>
              </div>

              {/* Instruction & Required Sentence */}
              <div>
                <p className={`text-sm font-bold mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                  Rewrite the sentence below:
                </p>
                <div className={`p-3 rounded-lg border font-mono text-sm font-semibold text-center ${isDark ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-300" : "bg-yellow-50 border-yellow-200 text-yellow-800"}`}>
                  "{REQUIRED_SENTENCE}"
                </div>
              </div>

              {/* Text Area */}
              <div>
                <textarea 
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    if (error) setError(false);
                  }}
                  placeholder="Type here..."
                  className={`w-full p-4 rounded-xl border outline-none min-h-[120px] resize-y transition-colors text-sm ${
                    isDark 
                      ? "bg-[#111] border-[#333] text-white focus:border-green-500" 
                      : "bg-white border-gray-300 text-gray-900 focus:border-green-500"
                  } ${error ? "!border-red-500" : ""}`}
                />
                
                {/* Error Message */}
                {error && (
                  <motion.p 
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-1.5 text-red-500 text-xs font-semibold mt-2"
                  >
                    <FaExclamationTriangle /> Please rewrite the sentence above to confirm closing the lead.
                  </motion.p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className={`p-4 border-t flex justify-end gap-3 ${isDark ? "border-[#222] bg-[#1a1a1a]" : "border-gray-100 bg-[#F8FAFC]"}`}>
              <button 
                onClick={onClose} 
                className={`px-5 py-2.5 text-sm font-bold rounded-xl border transition-colors ${
                  isDark 
                    ? "border-[#444] text-gray-300 hover:bg-[#222]" 
                    : "border-gray-300 text-gray-700 hover:bg-gray-100"
                }`}
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirm} 
                className="px-5 py-2.5 text-sm font-bold bg-green-600 hover:bg-green-500 text-white rounded-xl shadow-lg transition-colors"
              >
                Confirm & Mark Closing
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
