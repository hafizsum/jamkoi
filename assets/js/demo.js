/* Sample data shown when Firebase is not configured yet (nothing is saved). */
export function demoData(now = Date.now()) {
  const m = (x) => now - x * 60000;
  const r = (id, uid, type, level, lat, lng, road, loc, ago, desc = '', ttl = 90) => ({
    id, uid, type, level, lat, lng, road, desc, locationId: loc, precision: 'pin', createdAt: m(ago), expiresAt: m(ago) + ttl * 60000,
  });
  const reports = [
    r('d01', 'u1', 'congestion', 'heavy', 23.7579, 90.3893, 'Bijoy Sarani', 'farmgate', 14, 'ফার্মগেট ফ্লাইওভারের নিচে গাড়ির দীর্ঘ লাইন'),
    r('d02', 'u2', 'congestion', 'heavy', 23.7583, 90.3898, 'Manik Mia Avenue', 'farmgate', 9, 'Almost no movement towards Khamarbari'),
    r('d03', 'u3', 'congestion', 'moderate', 23.7574, 90.3888, 'Farmgate Flyover', 'farmgate', 4),
    r('d04', 'u4', 'congestion', 'heavy', 23.7780, 90.4043, 'Mohakhali Flyover', 'mohakhali', 20, 'বাস টার্মিনালের সামনে জ্যাম'),
    r('d05', 'u5', 'congestion', 'heavy', 23.7784, 90.4038, 'Mohakhali Flyover', 'mohakhali', 11),
    r('d06', 'u6', 'congestion', 'moderate', 23.8072, 90.3684, 'Begum Rokeya Sarani', 'mirpur-10', 6, 'Slow but moving'),
    r('d07', 'u7', 'accident', 'heavy', 23.7100, 90.4345, 'Jatrabari Flyover', 'jatrabari', 25, 'ট্রাক ও বাসের সংঘর্ষ, এক লেন বন্ধ', 150),
    r('d08', 'u8', 'accident', 'heavy', 23.7109, 90.4338, 'Dhaka-Chattogram Highway', 'jatrabari', 15, '', 150),
    r('d09', 'u1', 'waterlogging', 'moderate', 23.7920, 90.4165, 'Gulshan-Badda Link Road', 'gulshan-2', 40, 'বৃষ্টির পর হাঁটুপানি', 300),
    r('d10', 'u2', 'roadwork', 'moderate', 23.7455, 90.3738, 'Satmasjid Road', 'dhanmondi', 70, 'Drain repair, one lane open', 720),
    r('d11', 'u3', 'congestion', 'moderate', 22.3258, 91.8099, 'Sheikh Mujib Road', 'agrabad', 18),
    r('d12', 'u4', 'congestion', 'clear', 23.7334, 90.4175, 'Dilkusha Road', 'motijheel', 8, 'এখন ফাঁকা'),
  ];
  const votes = [
    { reportId: 'd04', uid: 'u6', vote: 'confirm', isNear: true, createdAt: m(3) },
    { reportId: 'd07', uid: 'u5', vote: 'confirm', isNear: false, createdAt: m(5) },
  ];
  return { reports, votes };
}
