/**
 * Google Classroom Integration — Scaffold
 *
 * ACTIVATION STEPS (for Mr. D):
 * 1. Go to https://console.cloud.google.com
 * 2. Create a new project (or use an existing one)
 * 3. Enable the Google Classroom API:
 *    - Search "Classroom API", click Enable
 * 4. Set up OAuth consent screen:
 *    - APIs & Services > OAuth consent screen
 *    - External > Create
 *    - Add your email as a test user
 * 5. Create a Web client ID:
 *    - Credentials > Create Credentials > OAuth 2.0 Client ID
 *    - Application type: Web application
 *    - Authorized JavaScript origins: http://localhost:8000, https://yourdomain.com
 *    - Authorized redirect URIs: http://localhost:8000, https://yourdomain.com
 *    - Copy the Client ID
 * 6. Paste the Client ID into CLASSROOM_CONFIG.CLIENT_ID below
 * 7. Serve the app over https (or localhost for testing)
 * 8. This is a scaffold: nothing in the app calls initClassroomAuth() yet.
 *    Wiring it into main.js (or wherever this integration is switched on)
 *    is still future work — once that's done, calling it with CLIENT_ID
 *    set will initialize the Google Identity Services flow.
 */

export const CLASSROOM_CONFIG = {
  CLIENT_ID: '',  // Paste your OAuth 2.0 Client ID here
  SCOPES: [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.rosters.readonly',
  ],
  DISCOVERY: 'https://classroom.googleapis.com/$discovery/rest?version=v1',
};

/**
 * Initialize Google Identity Services token flow.
 * If CLIENT_ID is not configured, returns early with enabled: false.
 * Dynamically injects the Google Identity Services script.
 * Returns { enabled, reason, tokenClient } or { enabled: false, reason }
 */
export async function initClassroomAuth() {
  if (!CLASSROOM_CONFIG.CLIENT_ID) {
    return {
      enabled: false,
      reason: 'No CLIENT_ID configured. Set CLASSROOM_CONFIG.CLIENT_ID to activate.',
    };
  }

  // Dynamically load Google Identity Services
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) {
      // Already loaded
      initTokenClient(resolve);
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => initTokenClient(resolve);
      script.onerror = () => {
        resolve({ enabled: false, reason: 'Failed to load Google Identity Services' });
      };
      document.head.appendChild(script);
    }
  });
}

function initTokenClient(resolve) {
  try {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLASSROOM_CONFIG.CLIENT_ID,
      scope: CLASSROOM_CONFIG.SCOPES.join(' '),
      callback: () => {
        // Token obtained; fetchRosters will use it
      },
    });
    resolve({ enabled: true, tokenClient });
  } catch (err) {
    console.warn('initClassroomAuth: failed to initialize token client', err);
    resolve({ enabled: false, reason: 'Token client initialization failed' });
  }
}

/**
 * Fetch rosters from Google Classroom API.
 * Requires a valid OAuth token from Google Identity Services.
 * Returns [{ courseId, courseName, students: [{ id, name, email }] }]
 * On any error, logs a warning and returns []
 */
export async function fetchRosters(token) {
  if (!token) {
    console.warn('fetchRosters: no token provided');
    return [];
  }

  try {
    // Fetch list of courses
    const coursesRes = await fetch('https://classroom.googleapis.com/v1/courses', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!coursesRes.ok) {
      console.warn('fetchRosters: courses.list failed', coursesRes.status);
      return [];
    }

    const coursesData = await coursesRes.json();
    const courses = coursesData.courses || [];
    const rosters = [];

    // For each course, fetch the roster
    for (const course of courses) {
      try {
        const rosterRes = await fetch(
          `https://classroom.googleapis.com/v1/courses/${course.id}/students`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!rosterRes.ok) {
          console.warn(`fetchRosters: students.list for course ${course.id} failed`);
          continue;
        }

        const rosterData = await rosterRes.json();
        const students = (rosterData.students || []).map((s) => ({
          id: s.userId,
          name: s.profile?.name?.fullName || 'Unknown',
          email: s.profile?.emailAddress || '',
        }));

        rosters.push({
          courseId: course.id,
          courseName: course.name || 'Untitled Course',
          students,
        });
      } catch (err) {
        console.warn(`fetchRosters: error fetching students for course ${course.id}`, err);
      }
    }

    return rosters;
  } catch (err) {
    console.warn('fetchRosters: unexpected error', err);
    return [];
  }
}

/**
 * Map Google Classroom rosters to house cores.
 * Matches course names for period digits 1-4:
 *   "Social Studies — Period 3" → core 3 → house Valhalla
 *
 * Returns { [houseId]: { courseId, courseName, students }, unassigned: [...] }
 *
 * Core → House mapping:
 * 1 → Camelot (#ef4444 red)
 * 2 → Atlantis (#3b82f6 blue)
 * 3 → Valhalla (#f59e0b gold)
 * 4 → Rivendell (#22c55e green)
 */
export function bindRostersToHouses(rosters) {
  const CORE_TO_HOUSE = {
    1: 'Camelot',
    2: 'Atlantis',
    3: 'Valhalla',
    4: 'Rivendell',
  };

  const result = { unassigned: [] };

  for (const roster of rosters) {
    const courseNameLower = roster.courseName.toLowerCase();
    let matched = false;

    // Try to find period digit 1-4 in course name
    for (const period of [1, 2, 3, 4]) {
      if (courseNameLower.includes(`period ${period}`) ||
          courseNameLower.includes(`period${period}`) ||
          courseNameLower.includes(`period-${period}`)) {
        result[period] = {
          courseId: roster.courseId,
          courseName: roster.courseName,
          students: roster.students,
        };
        matched = true;
        break;
      }
    }

    if (!matched) {
      result.unassigned.push(roster);
    }
  }

  return result;
}
