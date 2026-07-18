"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FaBuilding, FaUser, FaArrowLeft } from "react-icons/fa";
import { MdEmail, MdLock, MdVisibility, MdVisibilityOff } from "react-icons/md";
import { HiOutlineRefresh } from "react-icons/hi";

export default function SignUp() {
  const router = useRouter();
  
  // All our state variables correctly defined
  const [role, setRole] = useState("employee");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check if passwords match
    if (password !== confirmPassword) {
        alert("Passwords do not match!");
        return;
    }

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }), 
      });

      if (res.ok) {
        alert("Account created successfully!");
        router.push("/"); // Send them back to login
      } else {
        const errorData = await res.json();
        alert(`Error: ${errorData.message}`);
      }
    } catch (error) {
      console.log("Error during registration: ", error);
    }
  };

  return (
    <div className="min-h-screen bg-[#121212] flex items-center justify-center p-4 relative">
      
      {/* Back Button */}
      <Link href="/" className="absolute top-6 left-6 text-purple-500 hover:text-purple-400">
        <FaArrowLeft className="text-xl" />
      </Link>

      <div className="bg-[#1a1a1a] w-full max-w-md rounded-2xl border border-[#2a2a2a] p-8 shadow-2xl mt-8">
        
        {/* Header */}
        <div className="text-center mb-6">
          <p className="text-purple-500 text-xs font-bold tracking-widest mb-4">SIGN UP</p>
          <div className="w-12 h-12 bg-[#2a2a2a] rounded-xl flex items-center justify-center mx-auto mb-4">
            <FaBuilding className="text-purple-500 text-2xl" />
          </div>
          <h1 className="text-white text-2xl font-bold">Create Account</h1>
          <p className="text-gray-400 text-sm mt-1">Join Bhoomi Dwellers today</p>
        </div>

        {/* Role Toggle */}
        <div className="flex bg-[#2a2a2a] rounded-lg p-1 mb-6">
          <button 
            type="button"
            onClick={() => setRole("employee")}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${role === "employee" ? "bg-[#1a1a1a] text-purple-500 shadow" : "text-gray-400 hover:text-gray-200"}`}
          >
            Employee
          </button>
          <button 
            type="button"
            onClick={() => setRole("admin")}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${role === "admin" ? "bg-[#1a1a1a] text-purple-500 shadow" : "text-gray-400 hover:text-gray-200"}`}
          >
            Admin
          </button>
        </div>

        {/* Form */}
        <div>
          <h2 className="text-white text-lg font-semibold mb-4">Registering as {role.charAt(0).toUpperCase() + role.slice(1)}</h2>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label className="block text-white text-xs font-medium mb-1.5">Full Name</label>
              <div className="relative">
                <FaUser className="absolute left-3 top-3.5 text-gray-500" />
                <input 
                  type="text" 
                  placeholder="John Doe" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded-lg py-2.5 pl-10 pr-4 focus:outline-none focus:border-purple-500 text-sm" 
                />
              </div>
            </div>

            <div>
              <label className="block text-white text-xs font-medium mb-1.5">Email Address</label>
              <div className="relative">
                <MdEmail className="absolute left-3 top-3.5 text-gray-500 text-lg" />
                <input 
                  type="email" 
                  placeholder="name@bhoomidwellers.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded-lg py-2.5 pl-10 pr-4 focus:outline-none focus:border-purple-500 text-sm" 
                />
              </div>
            </div>

            <div>
              <label className="block text-white text-xs font-medium mb-1.5">Password</label>
              <div className="relative">
                <MdLock className="absolute left-3 top-3.5 text-gray-500 text-lg" />
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded-lg py-2.5 pl-10 pr-10 focus:outline-none focus:border-purple-500 text-sm" 
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-300">
                  {showPassword ? <MdVisibilityOff /> : <MdVisibility />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-white text-xs font-medium mb-1.5">Confirm Password</label>
              <div className="relative">
                <HiOutlineRefresh className="absolute left-3 top-3.5 text-gray-500 text-lg" />
                <input 
                  type={showConfirmPassword ? "text" : "password"} 
                  placeholder="••••••••" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded-lg py-2.5 pl-10 pr-10 focus:outline-none focus:border-purple-500 text-sm" 
                />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-300">
                  {showConfirmPassword ? <MdVisibilityOff /> : <MdVisibility />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" required className="accent-purple-500 w-4 h-4" />
              <label className="text-gray-400 text-xs">
                I agree to the <Link href="#" className="text-purple-500 hover:underline">Terms</Link> and <Link href="#" className="text-purple-500 hover:underline">Privacy Policy</Link>
              </label>
            </div>

            <button type="submit" className="w-full bg-[#a855f7] hover:bg-[#9333ea] text-white font-medium py-2.5 rounded-lg transition-colors mt-2 text-sm">
              Create Account
            </button>
          </form>

          <div className="text-center mt-6 text-sm text-gray-400">
            Already have an account? <Link href="/" className="text-purple-500 hover:text-purple-400 font-medium">Log In</Link>
          </div>
        </div>
      </div>
    </div>
  );
}