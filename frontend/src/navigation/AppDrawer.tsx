import React, { useEffect } from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import DrawerContent from '../components/DrawerContent';
import MainTabs from './MainTabs';
import { TeamStack, ShortformStack, AdminStack } from './flowStacks';
import { ProfileProvider } from '../context/ProfileContext';
import { useAuth } from '../context/AuthContext';
import { updateMyLocation } from '../api/auth';

const Drawer = createDrawerNavigator();

const LOCATION_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

export default function AppDrawer() {
  const { width } = useWindowDimensions();
  const { isAdmin } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const pushLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;

        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;

        await updateMyLocation(pos.coords.latitude, pos.coords.longitude);
      } catch {
      }
    };

    pushLocation();
    const timer = setInterval(pushLocation, LOCATION_UPDATE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <ProfileProvider>
      <Drawer.Navigator
        drawerContent={(props) => <DrawerContent {...props} />}
        screenOptions={{
          headerShown: false,
          drawerPosition: 'right',
          drawerType: 'front',
          drawerStyle: { width: Math.min(320, width * 0.82) },
          swipeEnabled: false,
        }}
      >
        <Drawer.Screen name="Tabs" component={MainTabs} />
        <Drawer.Screen name="TeamChallenge" component={TeamStack} />
        <Drawer.Screen name="Shortform" component={ShortformStack} />
        {isAdmin ? (
          <Drawer.Screen name="Admin" component={AdminStack} />
        ) : null}
      </Drawer.Navigator>
    </ProfileProvider>
  );
}