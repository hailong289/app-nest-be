// src/modules/firebase/firebase.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
    private app: admin.app.App;

    constructor(private readonly configService: ConfigService) { }

    onModuleInit() {
        if (!admin.apps.length) {
            try {
                this.app = admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: this.configService.get<string>('firebase.projectId'),
                        clientEmail: this.configService.get<string>('firebase.clientEmail'),
                        privateKey: this.configService.get<string>('firebase.privateKey'),
                    }),
                    storageBucket: this.configService.get<string>('firebase.storageBucket'),
                });
                console.log('🔥 Firebase initialized');
            } catch (error) {
                console.log('🔥 Firebase initialization error:', error);
            }
    } else {
            this.app = admin.app();
        }
    }

    getAuth() {
        return admin.auth(this.app);
    }

    getFirestore() {
        return admin.firestore(this.app);
    }

    getStorage() {
        return admin.storage(this.app);
    }

    getMessaging() {
        return admin.messaging(this.app);
    }

    getApp() {
        return this.app;
    }
}
