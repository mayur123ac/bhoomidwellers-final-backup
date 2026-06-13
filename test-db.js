const { loadEnvConfig } = require('@next/env');
loadEnvConfig('./');
const { query } = require('./src/lib/db');

query(`
      SELECT 
        u.id as user_id,
        u.name,
        u.email,
        u.role,
        CASE WHEN s.is_active THEN l.current_module ELSE NULL END as current_module,
        CASE WHEN s.is_active THEN l.active_lead_id ELSE NULL END as active_lead_id,
        CASE WHEN s.is_active THEN l.active_lead_name ELSE NULL END as active_lead_name,
        CASE WHEN s.is_active THEN l.current_action ELSE NULL END as current_action,
        CASE WHEN s.is_active THEN l.current_route ELSE NULL END as current_route,
        CASE WHEN s.is_active THEN l.last_activity ELSE NULL END as last_activity,
        CASE WHEN s.is_active THEN l.idle_duration_seconds ELSE 0 END as idle_duration_seconds,
        CASE WHEN s.is_active THEN l.productivity_score ELSE 0 END as productivity_score,
        l.is_idle,
        a.status as attendance_status,
        s.session_start,
        s.session_end,
        s.is_active as session_is_active,
        s.ip_address,
        s.attendance_status,
        s.device_info,
        sc.active_sessions_count,
        
        EXTRACT(EPOCH FROM (NOW() - s.session_start)) as session_duration_seconds,
        CASE 
          WHEN s.is_active = false THEN 'OFFLINE'
          WHEN l.is_idle THEN 'IDLE'
          ELSE 'ACTIVE'
        END as status
      FROM users u
      JOIN (
        SELECT DISTINCT ON (user_id) * 
        FROM employee_sessions 
        WHERE DATE(session_start AT TIME ZONE 'Asia/Kolkata') = '2026-06-12'
        ORDER BY user_id, session_start DESC
      ) s ON u.id = s.user_id
      LEFT JOIN (
        SELECT user_id, COUNT(id) as active_sessions_count 
        FROM employee_sessions 
        WHERE is_active = true AND DATE(session_start AT TIME ZONE 'Asia/Kolkata') = '2026-06-12'
        GROUP BY user_id
      ) sc ON u.id = sc.user_id
      LEFT JOIN employee_live_state l ON u.id = l.user_id
      LEFT JOIN employee_attendance a ON u.id = a.user_id AND a.date = '2026-06-12'
      ORDER BY l.productivity_score DESC NULLS LAST, s.session_start DESC
`).then(console.log).catch(console.error);
